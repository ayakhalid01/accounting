# Netlify Deployment Guide

## Problem: ERR_CONNECTION_TIMED_OUT

### الأسباب المحتملة:
1. ✗ الـ build يستغرق وقت طويل (>30 ثانية)
2. ✗ الـ batch operations طويلة (upload/delete)
3. ✗ الـ database queries غير محسّنة
4. ✗ Netlify timeout افتراضي قصير جداً

---

## الحل: خطوات التحسين

### 1. **تحديث Environment Variables**
```bash
# في Netlify Dashboard:
Site Settings → Build & Deploy → Environment
```

أضف:
```
NEXT_PUBLIC_SUPABASE_URL=https://uextcqbydbrqiwteholv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NODE_ENV=production
```

### 2. **تحسين Build Performance**

في `next.config.ts`:
```typescript
const nextConfig = {
  compress: true,
  swcMinify: true,
  productionBrowserSourceMaps: false,
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react"],
  },
};
```

### 3. **تقسيم العمليات الطويلة**

**قبل (❌ Timeout):**
```typescript
await deleteBatch('invoices', 'invoices'); // 1000s items = 30+ seconds
```

**بعد (✅ سريع):**
```typescript
// استخدم micro-batches (100 items each)
// مع delays صغيرة بينهم
```

### 4. **استخدام Scheduled Functions (اختياري)**

بدل العمليات الطويلة في الـ frontend:
```bash
npm install netlify-cli --save-dev
```

ثم في `.netlify/functions/refresh-allocations.js`:
```javascript
exports.handler = async (event, context) => {
  const { supabase } = require('@supabase/supabase-js');
  
  const client = supabase.createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  
  const { data, error } = await client
    .rpc('refresh_all_deposit_allocations');
  
  return { statusCode: 200, body: JSON.stringify(data) };
};
```

### 5. **Deploy Steps**

```bash
# 1. إضف netlify.toml الجديد
git add netlify.toml

# 2. Commit
git commit -m "Optimize Netlify deployment configuration"

# 3. Push
git push

# 4. في Netlify Dashboard:
- اختر Repository
- اتصل مع GitHub
- Select branch: main
- Build command: npm run build
- Publish directory: .next
- Deploy!
```

### 6. **Monitor Build Logs**

في Netlify Dashboard:
- Deploys → Latest Deploy → Logs
- شوف الـ errors والـ warnings
- اقرأ الـ build time

### 7. **إذا استمر الـ Timeout**

```bash
# قلّل حجم البيانات في الـ initial load
# أضف pagination للـ invoices/deposits
# استخدم ISR (Incremental Static Regeneration)
# or SSG مع revalidation
```

---

## Netlify Plan Limits

| المميزات | Free | Pro | Business |
|---------|------|-----|----------|
| Function Timeout | 30s | 26s | 900s |
| Build Time | 300s | 300s | 300s |
| Bandwidth | 100GB | unlimited | unlimited |

**ملاحظة:** لو العمليات أكثر من 30 ثانية → احتاج Pro Plan أو استخدم Scheduled Functions

---

## تجربة الـ Deploy

```bash
# Local build test
npm run build

# Run production build locally
npm start

# Check build output
ls -la .next/
```

---

## Common Errors و الحلول

| Error | السبب | الحل |
|-------|------|------|
| `ERR_CONNECTION_TIMED_OUT` | العملية طويلة جداً | قسّم الـ batches أو استخدم Pro |
| `Module not found` | Dependency missing | `npm install` |
| `Build command failed` | Syntax errors | `npm run build` locally |
| `503 Service Unavailable` | الـ API بطيء | قلّل من الـ initial data |

---

## نصائح سريعة

✅ استخدم `next/image` بدل `<img>`  
✅ كود split مع dynamic imports  
✅ lazy load الـ components الثقيلة  
✅ استخدم `React.memo` للـ components الثابتة  
✅ أضف `suspense` للـ async operations  

---

**الآن:** اضغط "Deploy" في Netlify Dashboard 🚀
