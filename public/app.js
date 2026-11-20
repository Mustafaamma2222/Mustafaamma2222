/* ميزانيتي الشهرية — منطق التطبيق */
(function () {
  "use strict";

  // ---------- ثوابت ----------
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const DEFAULT_CATS = ["طعام", "اشتراكات", "ادخار", "إنترنت"];
  const CURRENCIES = [
    ["", "بدون رمز"], ["د.ع", "دينار عراقي"], ["ر.س", "ريال سعودي"], ["د.إ", "درهم إماراتي"],
    ["د.ك", "دينار كويتي"], ["ر.ق", "ريال قطري"], ["د.ب", "دينار بحريني"], ["ر.ع", "ريال عماني"],
    ["د.أ", "دينار أردني"], ["ج.م", "جنيه مصري"], ["د.م", "درهم مغربي"], ["$", "دولار أمريكي"],
    ["€", "يورو"], ["₺", "ليرة تركية"]
  ];
  const SLOT_COUNT = 8;
  const OTHER = "أخرى";

  // ---------- أدوات ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("ar-u-nu-latn", { maximumFractionDigits: 2 });
  const pf = new Intl.NumberFormat("ar-u-nu-latn", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* تجاهل */ } };
  const keyOf = (y, m) => y * 100 + m;
  const labelOf = (y, m) => `${MONTHS[m - 1]} ${y}`;
  const toNum = (v) => { const n = parseFloat(String(v).replace(/,/g, "")); return isFinite(n) && n > 0 ? n : 0; };

  let currency = safeGet("currency") ?? "";
  const money = (n) => `<span class="num">${nf.format(n)}</span>${currency ? ` <span class="muted small">${esc(currency)}</span>` : ""}`;
  const moneyTxt = (n) => `${nf.format(n)}${currency ? " " + currency : ""}`;
  const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
  const pctTxt = (v) => (v === null ? "—" : `${pf.format(v)}%`);

  function deltaHtml(cur, prev) {
    if (prev === undefined || prev === null) return `<span class="delta zero">—</span>`;
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return `<span class="delta zero">0</span>`;
    const arrow = d > 0 ? "▲" : "▼";
    const rel = prev > 0 ? ` <span class="num muted">(${d > 0 ? "+" : ""}${pf.format((d / prev) * 100)}%)</span>` : "";
    return `<span class="delta"><span class="num">${arrow} ${nf.format(Math.abs(d))}</span>${rel}</span>`;
  }

  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", !!isError);
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function showView(id) {
    ["#setupView", "#authView", "#resetView", "#mainView"].forEach((v) => $(v).classList.toggle("hidden", v !== id));
    $("#signOutBtn").classList.toggle("hidden", id !== "#mainView");
    $("#loading").classList.add("hidden");
  }

  // ---------- الوضع الليلي ----------
  function currentTheme() { return document.documentElement.getAttribute("data-theme") || "light"; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", t === "dark" ? "#1a1a19" : "#fcfcfb");
  }
  applyTheme(currentTheme());
  $("#themeToggle").addEventListener("click", () => {
    const t = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(t);
    safeSet("theme", t);
    renderActiveTab();
  });

  // ---------- Supabase ----------
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /YOUR-/.test(cfg.SUPABASE_URL) || !window.supabase) {
    showView("#setupView");
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // ---------- الحالة ----------
  const now = new Date();
  const state = {
    user: null,
    months: [],            // [{id, year, month, salary, expenses:[{name, amount}], updated_at}]
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    draft: [],             // [{name, amount, custom}]
    tab: "entry",
    trendMode: "totals",
    charts: {},
    colorMap: new Map()
  };

  const findMonth = (y, m) => state.months.find((r) => r.year === y && r.month === m);
  const sortedMonths = () => [...state.months].sort((a, b) => keyOf(a.year, a.month) - keyOf(b.year, b.month));
  const prevSaved = (y, m) => sortedMonths().filter((r) => keyOf(r.year, r.month) < keyOf(y, m)).pop();
  const totalOf = (r) => (r.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const amountOf = (r, name) => { const e = (r.expenses || []).find((x) => x.name === name); return e ? Number(e.amount) || 0 : 0; };

  // ألوان ثابتة لكل فئة حسب ترتيب ظهورها (اللون يتبع الفئة لا ترتيبها)
  function rebuildColorMap() {
    state.colorMap = new Map();
    DEFAULT_CATS.forEach((n) => state.colorMap.set(n, state.colorMap.size));
    sortedMonths().forEach((r) => (r.expenses || []).forEach((e) => {
      if (!state.colorMap.has(e.name)) state.colorMap.set(e.name, state.colorMap.size);
    }));
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function colorFor(name) {
    if (name === OTHER) return cssVar("--s-other");
    if (!state.colorMap.has(name)) state.colorMap.set(name, state.colorMap.size);
    const i = state.colorMap.get(name);
    return i < SLOT_COUNT ? cssVar(`--s${i + 1}`) : cssVar("--s-other");
  }

  // ---------- المصادقة ----------
  let authMode = "signin";
  $$("#authView .seg").forEach((b) => b.addEventListener("click", () => {
    authMode = b.dataset.mode;
    $$("#authView .seg").forEach((x) => x.classList.toggle("active", x === b));
    $("#authTitle").textContent = authMode === "signin" ? "تسجيل الدخول" : "إنشاء حساب جديد";
    $("#authSubmit").textContent = authMode === "signin" ? "دخول" : "إنشاء الحساب";
    $("#authPassword").autocomplete = authMode === "signin" ? "current-password" : "new-password";
    $("#forgotBtn").classList.toggle("hidden", authMode !== "signin");
    setMsg("#authMsg", "");
  }));

  function setMsg(sel, text, isError) {
    const el = $(sel);
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  const AUTH_ERRORS = {
    "Invalid login credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "Email not confirmed": "لم يتم تأكيد البريد الإلكتروني بعد. تحقق من بريدك.",
    "User already registered": "هذا البريد مسجّل مسبقاً.",
    "Password should be at least 6 characters.": "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
  };
  const authErr = (e) => AUTH_ERRORS[e?.message] || e?.message || "حدث خطأ غير متوقع.";

  $("#authForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || password.length < 6) return setMsg("#authMsg", "أدخل بريداً صحيحاً وكلمة مرور من 6 أحرف على الأقل.", true);
    const btn = $("#authSubmit");
    btn.disabled = true;
    setMsg("#authMsg", "جارٍ المعالجة…");
    try {
      if (authMode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("#authMsg", "");
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) setMsg("#authMsg", "تم إنشاء الحساب. افتح رابط التأكيد المرسل إلى بريدك ثم سجّل الدخول.");
      }
    } catch (e) {
      setMsg("#authMsg", authErr(e), true);
    } finally {
      btn.disabled = false;
    }
  });

  $("#forgotBtn").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) return setMsg("#authMsg", "اكتب بريدك الإلكتروني أولاً.", true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    setMsg("#authMsg", error ? authErr(error) : "تم إرسال رابط إعادة التعيين إلى بريدك.", !!error);
  });

  $("#resetForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const password = $("#newPassword").value;
    if (password.length < 6) return setMsg("#resetMsg", "كلمة المرور يجب أن تكون 6 أحرف على الأقل.", true);
    const { error } = await sb.auth.updateUser({ password });
    if (error) return setMsg("#resetMsg", authErr(error), true);
    toast("تم تحديث كلمة المرور");
    enterApp();
  });

  $("#signOutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  let recovering = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showView("#resetView"); return; }
    if (recovering) return;
    const newUser = session?.user || null;
    if (newUser && (!state.user || state.user.id !== newUser.id)) {
      state.user = newUser;
      enterApp();
    } else if (!newUser) {
      state.user = null;
      state.months = [];
      destroyCharts();
      showView("#authView");
    }
  });

  // ---------- تحميل البيانات ----------
  async function loadMonths() {
    const { data, error } = await sb.from("months")
      .select("id, year, month, salary, expenses, updated_at")
      .order("year", { ascending: true }).order("month", { ascending: true });
    if (error) throw error;
    state.months = (data || []).map((r) => ({
      ...r,
      salary: Number(r.salary) || 0,
      expenses: Array.isArray(r.expenses) ? r.expenses.map((e) => ({ name: String(e.name), amount: Number(e.amount) || 0 })) : []
    }));
    rebuildColorMap();
  }

  async function enterApp() {
    recovering = false;
    $("#loading").classList.remove("hidden");
    try {
      await loadMonths();
    } catch (e) {
      toast("تعذّر تحميل البيانات: " + (e.message || ""), true);
    }
    // افتح آخر شهر محفوظ إن لم يكن الشهر الحالي محفوظاً
    if (!findMonth(state.year, state.month) && state.months.length) {
      const last = sortedMonths().pop();
      if (keyOf(last.year, last.month) > keyOf(state.year, state.month)) { state.year = last.year; state.month = last.month; }
    }
    showView("#mainView");
    buildPickers();
    selectMonth(state.year, state.month);
  }

  // ---------- اختيار الشهر ----------
  function buildPickers() {
    $("#monthSelect").innerHTML = MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
    const years = state.months.map((r) => r.year).concat([now.getFullYear() - 2, now.getFullYear() + 1, state.year]);
    const minY = Math.min(...years), maxY = Math.max(...years);
    let opts = "";
    for (let y = maxY; y >= minY; y--) opts += `<option value="${y}">${y}</option>`;
    $("#yearSelect").innerHTML = opts;
    $("#currencySelect").innerHTML = CURRENCIES.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}${v ? " (" + esc(v) + ")" : ""}</option>`).join("");
    $("#currencySelect").value = currency;
  }

  function selectMonth(y, m) {
    state.year = y; state.month = m;
    if (!$(`#yearSelect option[value="${y}"]`)) buildPickers();
    $("#monthSelect").value = String(m);
    $("#yearSelect").value = String(y);
    loadDraft();
    renderEntry();
    updateStatus();
    renderActiveTab();
  }

  function shiftMonth(delta) {
    let m = state.month + delta, y = state.year;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    selectMonth(y, m);
  }
  // في الواجهة العربية: السهم الأيمن = السابق، الأيسر = التالي
  $("#prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("#nextMonth").addEventListener("click", () => shiftMonth(1));
  $("#monthSelect").addEventListener("change", (e) => selectMonth(state.year, +e.target.value));
  $("#yearSelect").addEventListener("change", (e) => selectMonth(+e.target.value, state.month));

  function updateStatus() {
    const r = findMonth(state.year, state.month);
    $("#monthStatus").textContent = r
      ? `شهر محفوظ · آخر تعديل ${new Date(r.updated_at).toLocaleDateString("ar-u-nu-latn", { day: "numeric", month: "long", year: "numeric" })}`
      : "شهر جديد — لم يُحفظ بعد";
    $("#deleteMonthBtn").classList.toggle("hidden", !r);
  }

  // ---------- الإدخال ----------
  function loadDraft() {
    const r = findMonth(state.year, state.month);
    if (r) {
      $("#salaryInput").value = r.salary || "";
      const names = r.expenses.map((e) => e.name);
      state.draft = DEFAULT_CATS.filter((n) => !names.includes(n)).map((n) => ({ name: n, amount: "", custom: false }))
        .concat(r.expenses.map((e) => ({ name: e.name, amount: e.amount || "", custom: !DEFAULT_CATS.includes(e.name) })));
      // ترتيب: الافتراضية أولاً
      state.draft.sort((a, b) => (a.custom === b.custom ? 0 : a.custom ? 1 : -1));
    } else {
      $("#salaryInput").value = "";
      const prev = prevSaved(state.year, state.month);
      const custom = prev ? prev.expenses.map((e) => e.name).filter((n) => !DEFAULT_CATS.includes(n)) : [];
      state.draft = DEFAULT_CATS.map((n) => ({ name: n, amount: "", custom: false }))
        .concat(custom.map((n) => ({ name: n, amount: "", custom: true })));
    }
  }

  function renderEntry() {
    const list = $("#categoryList");
    list.innerHTML = state.draft.map((c, i) => `
      <div class="cat-row" data-i="${i}">
        <div class="cat-name">
          <span class="dot" style="background:${colorFor(c.name)}"></span>
          ${c.custom
            ? `<input type="text" class="cat-label" maxlength="40" value="${esc(c.name)}" aria-label="اسم الفئة" />`
            : `<span>${esc(c.name)}</span>`}
        </div>
        <div class="money-input">
          <input type="number" inputmode="decimal" min="0" step="any" class="cat-amount" value="${esc(c.amount)}" placeholder="0" aria-label="مبلغ ${esc(c.name)}" />
        </div>
        ${c.custom ? `<button type="button" class="remove" aria-label="حذف الفئة ${esc(c.name)}" title="حذف">×</button>` : `<span></span>`}
      </div>`).join("");
    $$("[data-cur]").forEach((el) => (el.textContent = currency));
    updateEntryTotal();
  }

  function updateEntryTotal() {
    const salary = toNum($("#salaryInput").value);
    const total = state.draft.reduce((s, c) => s + toNum(c.amount), 0);
    $("#entryTotal").innerHTML = `الإجمالي: ${money(total)} · المتبقي: ${money(salary - total)}`;
  }

  $("#categoryList").addEventListener("input", (e) => {
    const row = e.target.closest(".cat-row");
    if (!row) return;
    const c = state.draft[+row.dataset.i];
    if (e.target.classList.contains("cat-amount")) c.amount = e.target.value;
    if (e.target.classList.contains("cat-label")) c.name = e.target.value;
    updateEntryTotal();
  });
  $("#categoryList").addEventListener("click", (e) => {
    if (!e.target.classList.contains("remove")) return;
    const i = +e.target.closest(".cat-row").dataset.i;
    state.draft.splice(i, 1);
    renderEntry();
  });
  $("#salaryInput").addEventListener("input", updateEntryTotal);

  function addCategory() {
    const input = $("#newCatName");
    const name = input.value.trim();
    if (!name) return input.focus();
    if (name === OTHER) return toast("هذا الاسم محجوز، اختر اسماً آخر", true);
    if (state.draft.some((c) => c.name.trim() === name)) return toast("هذه الفئة موجودة مسبقاً", true);
    state.draft.push({ name, amount: "", custom: true });
    input.value = "";
    renderEntry();
    const rows = $$("#categoryList .cat-amount");
    rows[rows.length - 1]?.focus();
  }
  $("#addCatBtn").addEventListener("click", addCategory);
  $("#newCatName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });

  $("#monthForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const salary = toNum($("#salaryInput").value);
    const seen = new Set();
    const expenses = [];
    for (const c of state.draft) {
      const name = c.name.trim();
      if (!name) { setMsg("#saveMsg", "يوجد فئة بدون اسم.", true); return; }
      if (seen.has(name)) { setMsg("#saveMsg", `الفئة "${name}" مكررة.`, true); return; }
      seen.add(name);
      expenses.push({ name, amount: toNum(c.amount) });
    }
    const btn = $("#saveBtn");
    btn.disabled = true;
    setMsg("#saveMsg", "جارٍ الحفظ…");
    const row = { user_id: state.user.id, year: state.year, month: state.month, salary, expenses };
    const { data, error } = await sb.from("months").upsert(row, { onConflict: "user_id,year,month" })
      .select("id, year, month, salary, expenses, updated_at").single();
    btn.disabled = false;
    if (error) { setMsg("#saveMsg", "تعذّر الحفظ: " + error.message, true); return; }
    const saved = { ...data, salary: Number(data.salary) || 0, expenses: data.expenses.map((e) => ({ name: e.name, amount: Number(e.amount) || 0 })) };
    state.months = state.months.filter((r) => !(r.year === saved.year && r.month === saved.month)).concat(saved);
    rebuildColorMap();
    setMsg("#saveMsg", "");
    toast(`تم حفظ ${labelOf(state.year, state.month)}`);
    loadDraft(); renderEntry(); updateStatus();
  });

  $("#deleteMonthBtn").addEventListener("click", async () => {
    const r = findMonth(state.year, state.month);
    if (!r || !confirm(`حذف بيانات ${labelOf(r.year, r.month)} نهائياً؟`)) return;
    const { error } = await sb.from("months").delete().eq("id", r.id);
    if (error) return toast("تعذّر الحذف: " + error.message, true);
    state.months = state.months.filter((x) => x.id !== r.id);
    rebuildColorMap();
    toast("تم حذف الشهر");
    selectMonth(state.year, state.month);
  });

  // ---------- التبويبات ----------
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  function setTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${tab}`));
    renderActiveTab();
  }
  function renderActiveTab() {
    if (!state.user) return;
    if (state.tab === "entry") renderEntry();
    else if (state.tab === "analysis") renderAnalysis();
    else if (state.tab === "compare") renderCompare();
    else if (state.tab === "history") renderHistory();
  }

  // ---------- المخططات (إعدادات عامة) ----------
  function destroyCharts() {
    Object.values(state.charts).forEach((c) => c && c.destroy());
    state.charts = {};
  }
  function chartBase() {
    const text = cssVar("--text-2"), grid = cssVar("--border");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = text;
    return { text, grid, surface: cssVar("--surface") };
  }
  const tooltipBase = (surface) => ({
    rtl: true, textDirection: "rtl",
    backgroundColor: cssVar("--text"), titleColor: surface, bodyColor: surface,
    padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true
  });
  function setChart(key, canvas, config) {
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new Chart(canvas, config);
  }

  // جمع الفئات الصغيرة في "أخرى" عند تجاوز عدد الألوان المتاحة
  function foldCategories(items) {
    const sorted = [...items].sort((a, b) => b.amount - a.amount);
    if (sorted.length <= SLOT_COUNT) return sorted;
    const head = sorted.slice(0, SLOT_COUNT - 1);
    const rest = sorted.slice(SLOT_COUNT - 1).reduce((s, x) => s + x.amount, 0);
    return head.concat({ name: OTHER, amount: rest });
  }

  // ---------- التحليل ----------
  function renderAnalysis() {
    const r = findMonth(state.year, state.month);
    $("#analysisEmpty").classList.toggle("hidden", !!r);
    $("#analysisBody").classList.toggle("hidden", !r);
    if (!r) return;

    const prev = prevSaved(r.year, r.month);
    const total = totalOf(r);
    const remaining = r.salary - total;
    const prevTotal = prev ? totalOf(prev) : null;
    const spentPct = pct(total, r.salary);

    $("#kpis").innerHTML = `
      <div class="kpi"><div class="label">الراتب</div><div class="value">${money(r.salary)}</div>
        <div class="sub">${prev ? "السابق: " + moneyTxt(prev.salary) : "&nbsp;"}</div></div>
      <div class="kpi"><div class="label">إجمالي المصاريف</div><div class="value">${money(total)}</div>
        <div class="sub">${pctTxt(spentPct)} من الراتب</div>
        <div class="bar"><i style="width:${Math.min(100, spentPct || 0)}%"></i></div></div>
      <div class="kpi"><div class="label">المتبقي</div><div class="value">${money(remaining)}</div>
        <div class="sub">${pctTxt(pct(remaining, r.salary))} من الراتب</div></div>
      <div class="kpi"><div class="label">التغير في المصاريف</div><div class="value">${prev ? deltaHtml(total, prevTotal) : "—"}</div>
        <div class="sub">${prev ? "مقارنة بـ " + labelOf(prev.year, prev.month) : "لا يوجد شهر سابق محفوظ"}</div></div>`;

    $("#prevLabel").textContent = prev ? `المقارنة مع ${labelOf(prev.year, prev.month)}` : "";

    const names = r.expenses.map((e) => e.name);
    if (prev) prev.expenses.forEach((e) => { if (!names.includes(e.name)) names.push(e.name); });
    const rows = names.map((n) => ({ name: n, amount: amountOf(r, n), prev: prev ? amountOf(prev, n) : null }))
      .sort((a, b) => b.amount - a.amount);

    $("#catTable").innerHTML = `
      <thead><tr><th>الفئة</th><th>المبلغ</th><th>% من الراتب</th><th>% من المصاريف</th>${prev ? "<th>الشهر السابق</th><th>الفرق</th>" : ""}</tr></thead>
      <tbody>${rows.map((x) => {
        const ps = pct(x.amount, r.salary), pt = pct(x.amount, total), col = colorFor(x.name);
        return `<tr>
          <td><span class="dot" style="background:${col}"></span>${esc(x.name)}</td>
          <td>${money(x.amount)}</td>
          <td><div class="pct-cell"><span class="pct-bar"><i style="width:${Math.min(100, ps || 0)}%;background:${col}"></i></span><span class="num">${pctTxt(ps)}</span></div></td>
          <td class="num">${pctTxt(pt)}</td>
          ${prev ? `<td>${money(x.prev)}</td><td>${deltaHtml(x.amount, x.prev)}</td>` : ""}
        </tr>`;
      }).join("")}</tbody>
      <tfoot><tr><td>الإجمالي</td><td>${money(total)}</td><td class="num">${pctTxt(spentPct)}</td><td class="num">${total > 0 ? "100%" : "—"}</td>
        ${prev ? `<td>${money(prevTotal)}</td><td>${deltaHtml(total, prevTotal)}</td>` : ""}</tr>
        <tr><td>المتبقي</td><td>${money(remaining)}</td><td class="num">${pctTxt(pct(remaining, r.salary))}</td><td></td>
        ${prev ? `<td>${money(prev.salary - prevTotal)}</td><td>${deltaHtml(remaining, prev.salary - prevTotal)}</td>` : ""}</tr></tfoot>`;

    const { grid, surface } = chartBase();
    const items = r.expenses.filter((e) => e.amount > 0);

    // مخطط دائري
    const folded = foldCategories(items);
    setChart("pie", $("#pieChart"), {
      type: "doughnut",
      data: {
        labels: folded.length ? folded.map((x) => x.name) : ["لا توجد مصاريف"],
        datasets: [{
          data: folded.length ? folded.map((x) => x.amount) : [1],
          backgroundColor: folded.length ? folded.map((x) => colorFor(x.name)) : [grid],
          borderColor: surface, borderWidth: 2, hoverOffset: 6
        }]
      },
      options: {
        maintainAspectRatio: false, cutout: "58%",
        plugins: {
          legend: { position: "bottom", rtl: true, textDirection: "rtl", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
          tooltip: {
            ...tooltipBase(surface), enabled: folded.length > 0,
            callbacks: { label: (c) => ` ${c.label}: ${moneyTxt(c.raw)} (${pctTxt(pct(c.raw, total))} من المصاريف · ${pctTxt(pct(c.raw, r.salary))} من الراتب)` }
          }
        }
      }
    });

    // مخطط أعمدة (أفقي ليناسب أسماء الفئات على الجوال)
    const barItems = [...r.expenses].sort((a, b) => b.amount - a.amount);
    const barBox = $("#barChart").parentElement;
    barBox.style.height = Math.max(220, barItems.length * 40 + 40) + "px";
    setChart("bar", $("#barChart"), {
      type: "bar",
      data: {
        labels: barItems.map((x) => x.name),
        datasets: [
          { label: labelOf(r.year, r.month), data: barItems.map((x) => x.amount), backgroundColor: cssVar("--s1"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18, categoryPercentage: 0.7 },
          ...(prev ? [{ label: labelOf(prev.year, prev.month), data: barItems.map((x) => amountOf(prev, x.name)), backgroundColor: cssVar("--s2"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18, categoryPercentage: 0.7 }] : [])
        ]
      },
      options: {
        indexAxis: "y", maintainAspectRatio: false,
        scales: {
          x: { reverse: true, beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => nf.format(v) } },
          y: { position: "right", grid: { display: false }, border: { display: false } }
        },
        plugins: {
          legend: { display: !!prev, position: "top", align: "start", rtl: true, textDirection: "rtl", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8 } },
          tooltip: { ...tooltipBase(surface), callbacks: { label: (c) => ` ${c.dataset.label}: ${moneyTxt(c.raw)}` } }
        }
      }
    });
  }

  // ---------- المقارنة ----------
  $$("#trendMode .seg").forEach((b) => b.addEventListener("click", () => {
    state.trendMode = b.dataset.mode;
    $$("#trendMode .seg").forEach((x) => x.classList.toggle("active", x === b));
    renderTrend();
  }));
  $("#cmpA").addEventListener("change", renderCompareTable);
  $("#cmpB").addEventListener("change", renderCompareTable);

  function renderCompare() {
    const list = sortedMonths();
    const enough = list.length >= 2;
    $("#compareEmpty").classList.toggle("hidden", enough);
    $("#compareBody").classList.toggle("hidden", !enough);
    if (!enough) return;

    const opts = list.slice().reverse().map((r) => `<option value="${keyOf(r.year, r.month)}">${labelOf(r.year, r.month)}</option>`).join("");
    const curKey = findMonth(state.year, state.month) ? keyOf(state.year, state.month) : keyOf(list[list.length - 1].year, list[list.length - 1].month);
    const curRow = list.find((r) => keyOf(r.year, r.month) === curKey);
    const p = prevSaved(curRow.year, curRow.month) || list.find((r) => keyOf(r.year, r.month) !== curKey);
    $("#cmpA").innerHTML = opts; $("#cmpB").innerHTML = opts;
    $("#cmpA").value = String(curKey);
    $("#cmpB").value = String(keyOf(p.year, p.month));
    renderTrend();
    renderCompareTable();
  }

  function renderTrend() {
    const list = sortedMonths();
    if (list.length < 2) return;
    const { grid, surface } = chartBase();
    const labels = list.map((r) => labelOf(r.year, r.month));
    let datasets;
    if (state.trendMode === "totals") {
      datasets = [
        { label: "الراتب", data: list.map((r) => r.salary), color: cssVar("--s1") },
        { label: "إجمالي المصاريف", data: list.map(totalOf), color: cssVar("--s2") },
        { label: "المتبقي", data: list.map((r) => r.salary - totalOf(r)), color: cssVar("--s3") }
      ];
    } else {
      const totals = new Map();
      list.forEach((r) => r.expenses.forEach((e) => totals.set(e.name, (totals.get(e.name) || 0) + e.amount)));
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      const keep = ranked.length > SLOT_COUNT ? ranked.slice(0, SLOT_COUNT - 1) : ranked;
      datasets = keep.map((n) => ({ label: n, data: list.map((r) => amountOf(r, n)), color: colorFor(n) }));
      if (ranked.length > SLOT_COUNT) {
        datasets.push({ label: OTHER, data: list.map((r) => r.expenses.filter((e) => !keep.includes(e.name)).reduce((s, e) => s + e.amount, 0)), color: colorFor(OTHER) });
      }
    }
    setChart("line", $("#lineChart"), {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.color,
          borderWidth: 2, tension: 0.25, pointRadius: 4, pointHoverRadius: 6,
          pointBorderColor: surface, pointBorderWidth: 2
        }))
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { reverse: true, offset: true, grid: { display: false }, border: { display: false } },
          y: { position: "right", beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => nf.format(v) } }
        },
        plugins: {
          legend: { position: "top", align: "start", rtl: true, textDirection: "rtl", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
          tooltip: { ...tooltipBase(surface), callbacks: { label: (c) => ` ${c.dataset.label}: ${moneyTxt(c.raw)}` } }
        }
      }
    });
  }

  function renderCompareTable() {
    const byKey = (k) => state.months.find((r) => keyOf(r.year, r.month) === +k);
    const a = byKey($("#cmpA").value), b = byKey($("#cmpB").value);
    if (!a || !b) return;
    const names = [];
    [a, b].forEach((r) => r.expenses.forEach((e) => { if (!names.includes(e.name)) names.push(e.name); }));
    const ta = totalOf(a), tb = totalOf(b);
    const row = (label, va, vb, dot) => `<tr>
      <td>${dot ? `<span class="dot" style="background:${colorFor(label)}"></span>` : ""}${esc(label)}</td>
      <td>${money(va)}</td><td>${money(vb)}</td><td>${deltaHtml(va, vb)}</td></tr>`;
    $("#cmpTable").innerHTML = `
      <thead><tr><th>البند</th><th>${labelOf(a.year, a.month)}</th><th>${labelOf(b.year, b.month)}</th><th>الفرق</th></tr></thead>
      <tbody>${names.map((n) => row(n, amountOf(a, n), amountOf(b, n), true)).join("")}</tbody>
      <tfoot>
        ${row("الراتب", a.salary, b.salary)}
        ${row("إجمالي المصاريف", ta, tb)}
        ${row("المتبقي", a.salary - ta, b.salary - tb)}
        <tr><td>نسبة المصاريف من الراتب</td><td class="num">${pctTxt(pct(ta, a.salary))}</td><td class="num">${pctTxt(pct(tb, b.salary))}</td><td></td></tr>
      </tfoot>`;
  }

  // ---------- الأشهر ----------
  $("#currencySelect").addEventListener("change", (e) => {
    currency = e.target.value;
    safeSet("currency", currency);
    renderHistory();
  });

  function renderHistory() {
    const list = sortedMonths().reverse();
    $("#historyEmpty").classList.toggle("hidden", list.length > 0);
    $("#historyTable").classList.toggle("hidden", list.length === 0);
    if (!list.length) return;
    const curKey = keyOf(state.year, state.month);
    $("#historyTable").innerHTML = `
      <thead><tr><th>الشهر</th><th>الراتب</th><th>المصاريف</th><th>المتبقي</th><th>% المصروف</th><th>التغير في المصاريف</th></tr></thead>
      <tbody>${list.map((r) => {
        const t = totalOf(r), p = prevSaved(r.year, r.month), k = keyOf(r.year, r.month);
        return `<tr class="clickable ${k === curKey ? "current" : ""}" data-key="${k}" tabindex="0">
          <td><strong>${labelOf(r.year, r.month)}</strong></td>
          <td>${money(r.salary)}</td><td>${money(t)}</td><td>${money(r.salary - t)}</td>
          <td class="num">${pctTxt(pct(t, r.salary))}</td>
          <td>${p ? deltaHtml(t, totalOf(p)) : '<span class="delta zero">—</span>'}</td></tr>`;
      }).join("")}</tbody>`;
  }
  function openFromHistory(tr) {
    const k = +tr.dataset.key;
    selectMonth(Math.floor(k / 100), k % 100);
    setTab("analysis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#historyTable").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr) openFromHistory(tr); });
  $("#historyTable").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr && e.key === "Enter") openFromHistory(tr); });

  // ---------- بدء التشغيل ----------
  sb.auth.getSession().then(({ data }) => {
    if (!data.session && !recovering) showView("#authView");
  });
})();
