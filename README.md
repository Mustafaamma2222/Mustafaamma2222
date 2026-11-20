# ميزانيتي الشهرية

موقع شخصي لتتبع الميزانية الشهرية: واجهة عربية كاملة (من اليمين لليسار)، وضع ليلي ونهاري، تسجيل دخول، وتخزين بيانات كل مستخدم بشكل منفصل عبر **Supabase**، وجاهز للنشر على **Netlify**.

---

## المزايا

- **لكل شهر:** الراتب + المصاريف حسب الفئة (طعام، اشتراكات، ادخار، إنترنت) + فئات مخصصة تضيفها بنفسك.
- **كل شهر محفوظ لوحده:** تنقّل بين الأشهر، عدّل، احذف، وقارن.
- **تحليل كامل للشهر:** إجمالي المصاريف، المتبقي، مبلغ كل فئة ونسبتها من الراتب ومن المصاريف، والفرق مع الشهر السابق.
- **مخططات:** دائري (توزيع المصاريف)، أعمدة (مقارنة الفئات مع الشهر السابق)، خطي (الاتجاه عبر الأشهر — الإجماليات أو الفئات).
- **مقارنة أي شهرين** بجدول تفصيلي.
- **أرقام وتحليل فقط** — بدون نصائح أو توصيات.
- الوضع الليلي/النهاري واختيار العملة يُحفظان في المتصفح.

## هيكل المشروع

```
public/
  index.html         الصفحة
  styles.css         التصميم (فاتح/داكن، متجاوب)
  app.js             منطق التطبيق
  config.example.js  مثال لملف المفاتيح (للتشغيل المحلي)
scripts/
  build-config.js    يولّد public/config.js من متغيرات Netlify
supabase/
  schema.sql         الجدول + سياسات الأمان (RLS)
netlify.toml         إعدادات النشر
```

---

## ١) إعداد Supabase

1. أنشئ حساباً ومشروعاً جديداً على [supabase.com](https://supabase.com).
2. من القائمة الجانبية افتح **SQL Editor** ← **New query**، الصق محتوى الملف `supabase/schema.sql` كاملاً، ثم اضغط **Run**.
   - ينشئ جدول `months` ويفعّل **Row Level Security**، فلا يرى أي مستخدم إلا بياناته.
3. افتح **Project Settings** ← **API** (أو **API Keys**) وانسخ:
   - **Project URL** ← هذا هو `SUPABASE_URL`
   - مفتاح **anon / public** (أو **publishable**) ← هذا هو `SUPABASE_ANON_KEY`

   > ⚠️ لا تستخدم مفتاح `service_role` / `secret` أبداً في الموقع. المفتاح العام آمن لأن الحماية تتم عبر سياسات RLS.
4. افتح **Authentication** ← **Sign In / Providers** وتأكد أن **Email** مفعّل.
   - إن أردت الدخول مباشرة بدون رسالة تأكيد، عطّل خيار **Confirm email**.
5. بعد النشر على Netlify (الخطوة التالية) افتح **Authentication** ← **URL Configuration**:
   - **Site URL**: رابط موقعك، مثل `https://your-site.netlify.app`
   - **Redirect URLs**: أضف نفس الرابط (ليعمل رابط تأكيد البريد وإعادة تعيين كلمة المرور).

## ٢) النشر على Netlify

1. ادخل [app.netlify.com](https://app.netlify.com) ← **Add new site** ← **Import an existing project** ← **GitHub**، واختر هذا المستودع والفرع المطلوب.
2. إعدادات البناء تُقرأ تلقائياً من `netlify.toml`:
   - **Build command:** `node scripts/build-config.js`
   - **Publish directory:** `public`
3. قبل النشر (أو بعده) افتح **Site configuration** ← **Environment variables** ← **Add a variable**، وأضف:

   | المفتاح | القيمة |
   |---|---|
   | `SUPABASE_URL` | Project URL من Supabase |
   | `SUPABASE_ANON_KEY` | المفتاح العام anon/publishable |

4. اضغط **Deploys** ← **Trigger deploy** ← **Deploy site** حتى يُبنى الموقع بالمفاتيح.
5. ارجع إلى Supabase وضع رابط الموقع في **Site URL** كما في الخطوة ١-٥.

> إذا ظهرت رسالة «الإعداد غير مكتمل» فالمتغيرات غير مضافة أو لم يُعد النشر بعد إضافتها.

## ٣) التشغيل المحلي (اختياري)

```bash
cp public/config.example.js public/config.js   # ثم ضع المفاتيح داخله
npm run dev                                    # يفتح على http://localhost:5173
```

ملف `public/config.js` مُستثنى من Git حتى لا تُرفع مفاتيحك بالخطأ.

---

## ملاحظات تقنية

- **بدون إطار عمل:** HTML/CSS/JavaScript فقط، والمكتبات من CDN مع بصمة أمان (SRI):
  [supabase-js 2.45.4](https://github.com/supabase/supabase-js) و [Chart.js 4.4.1](https://www.chartjs.org).
- **البيانات:** صف واحد لكل (مستخدم، سنة، شهر)، والمصاريف مخزنة كـ JSON: `[{ "name": "طعام", "amount": 500 }]`.
- **الحماية:** سياسات RLS تشترط `auth.uid() = user_id` للقراءة والإضافة والتعديل والحذف.
