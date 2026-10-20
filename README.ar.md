# opendesign

**وكيل تصميم بالذكاء الاصطناعي تحادثه — فيُصمّم لك فعلياً.**

opendesign هو تطبيق دردشة على طراز Codex/opencode متصل بخادم تصميم عبر بروتوكول MCP (Model Context Protocol). تصف الواجهة التي تريدها، فيخطط الوكيل ويستدعي أدوات MCP ويبني التصميم الحقيقي داخل [OpenFigma](https://github.com/Ultrasound123D/openfigma) — بينما ترى مباشرة **ماذا يفكّر، ومتى يخطط، وأي أدوات يستخدم**.

```
┌────────────┐   SSE    ┌───────────────────────────────────────────┐
│  المتصفح   │ ◀──────▶ │  opendesign (Next.js)                     │
│ واجهة الدردشة│ fetch   │  ├─ /api/chat ── محرك الوكيل (حلقة الأدوات)│
└────────────┘          │  ├─ سجل المزودين (models.dev + مخصصين)     │
                        │  ├─ مدير عميل MCP                          │
                        │  └─ الجلسات + الذاكرة (ملفات JSON)          │
                        └──────────────┬───────────────┬────────────┘
                                       │               │
                          أي مزود LLM  │               │ MCP (stdio / HTTP)
                  (OpenAI, Anthropic,  │               ▼
                   Google, OpenRouter,│        خادم OpenFigma MCP
                   Groq, DeepSeek,    │        (52 أداة تصميم)
                   xAI, Z.ai, مخصص…)  │               │
                                          ▼
                                    محرر OpenFigma
                                 (تحديثات حية على الكانفس)
```

## الميزات

### المزودون — بنفس طريقة opencode تماماً
- **الكتالوج الكامل** من [models.dev](https://models.dev) (نفس مصدر opencode — أكثر من 200 مزود: OpenAI وAnthropic وGoogle وOpenRouter وGroq وDeepSeek وMistral وxAI وZ.ai وغيرها)، مع تخزين مؤقت على القرص لمدة 24 ساعة وقائمة احتياطية عند انقطاع الشبكة.
- **توكن API ونقطة نهاية لكل مزود** (الإعدادات ← المزودون): الصق المفتاح، وعدّل عنوان الـ endpoint إن أردت. المفاتيح تُحفظ محلياً في `~/.opendesign/settings.json` ولا تُرسل إلا للمزود الذي اخترته.
- **الاسترجاع من متغيرات البيئة** مثل opencode: لكل مزود أسماء متغيراته (`OPENAI_API_KEY` و`ANTHROPIC_API_KEY`…) إضافة إلى الصيغة العامة `OPENDESIGN_<المزود>_API_KEY`.
- **مزودون مخصصون** (أسلوب opencode): أي endpoint متوافق مع OpenAI مع دعم التعويض `{env:NAME}` في العنوان:

```jsonc
// ~/.opendesign/settings.json
{
  "customProviders": {
    "acme": {
      "name": "Acme",
      "baseURL": "https://llm.acme.example/v1",   // يدعم {env:ACME_URL}
      "apiKey": "…",                               // أو env: ["ACME_API_KEY"]
      "models": { "qwen3-coder": { "name": "Qwen 3 Coder" } }
    }
  }
}
```

### شفافية بث كاملة
كل رد من المساعد يصل كأحداث منظّمة (نفس نموذج أحداث opencode):
- 💭 **التفكير** — كتل reasoning قابلة للطي لنماذج التفكير، تتحدث أثناء البث مباشرة
- 📝 **وضع التخطيط** — مفتاح Build/Plan مثل تبديل الوكلاء في opencode. وضع الخطة للقراءة فقط (تُستبعد الأدوات المُعدِّلة) وعلى الوكيل استدعاء `write_plan`؛ وتُحفظ الخطة في الجلسة وتُحقن تلقائياً عند التحويل إلى Build
- 🔧 **بطاقات أدوات MCP** — كل استدعاء أداة يعرض اسمها ووسائطها (تُبث حية أثناء كتابتها) وحالتها (تحضير ← تنفيذ ← مكتمل/فشل) ومخرجاتها

### الذاكرة
- **الجلسات** — كل محادثة محفوظة (`~/.opendesign/sessions/*.json`) بكامل أجزائها ويمكن استئنافها في أي وقت
- **ذاكرة طويلة المدى** — للوكيل أدوات `memory_save` / `memory_search` / `memory_list` / `memory_delete`؛ وتُحقن أحدث الذكريات تلقائياً في كل برومبت نظام (opencode v2 بلا نظام ذاكرة — هذه إضافة مقصودة)

### تكامل MCP
- خوادم محلية (stdio) وبعيدة (HTTP)، تُضبط من الإعدادات ← MCP أو من `settings.json`
- الأدوات تُسبق باسم الخادم `{server}_{tool}` (تقليد opencode)، ومخططات JSON للخادم تمر كما هي دون تحويل
- مهلة تنفيذ لكل خادم، إعادة اتصال تلقائية، حالة حية + مستكشف أدوات
- البذرة الافتراضية: يكتشف تلقائياً وجود مجلد `openfigma/` مجاور ويسجل خادم MCP الخاص به (52 أداة: مشاريع، عناصر، تحويلات، تنسيق، صفحات، رسم مركّب)

## البدء السريع

```bash
# 1. التثبيت
bun install        # أو: npm install

# 2. تشغيل محرر التصميم (OpenFigma) — يحتاج منفذاً خاصاً
git clone https://github.com/Ultrasound123D/openfigma ../openfigma
cd ../openfigma && npm install && npm run build && npm run start   # منفذ 3000

# 3. تشغيل opendesign (استخدم منفذاً آخر للمحرر، مثل 3111)
cd ../opendesign
OPENFIGMA_API_URL=http://localhost:3111 bun run dev                # منفذ 3000
```

ثم:
1. افتح **الإعدادات ← المزودون** والصق مفتاح API لأي مزود (أو صدّر مثلاً `OPENAI_API_KEY` قبل التشغيل)، أو أضف **مزوداً مخصصاً**.
2. تأكد من أن خادم MCP يشير إلى محررك: **الإعدادات ← MCP ← openfigma** — يُزرع الأمر تلقائياً إن وُجد `../openfigma`؛ اضبط `EDITOR_API_URL` في بيئته على عنوان محررك.
3. اكتب: *"اعمل شاشة مشغل موسيقى للجوال بثيم داكن"* وشاهده يبني.

> **لا تملك مفتاح API؟** على المنصات التي تتوفر فيها حزمة `z-ai-web-dev-sdk` يظهر مزود **`zai-sandbox`** مدمجاً (GLM-4.6) ويعمل دون أي إعداد. وفي النسخة العادية من المستودع لا يظهر إطلاقاً.

### البيانات والإعداد

| المسار | المحتوى |
|---|---|
| `~/.opendesign/settings.json` | المزودون (مفاتيح/عناوين)، المزودون المخصصون، خوادم MCP، النموذج الافتراضي، خطوات الوكيل |
| `~/.opendesign/sessions/` | ملف JSON لكل جلسة |
| `~/.opendesign/memory.json` | الذكريات طويلة المدى |
| `~/.opendesign/catalog-cache.json` | تخزين كتالوج models.dev المؤقت |

غيّر الدليل عبر `OPENDESIGN_DATA_DIR`.

### الأوامر

```bash
bun run dev    # خادم التطوير (منفذ 3000)
bun run build  # بناء إنتاجي (standalone)
bun run start  # تشغيل خادم الإنتاج
bun run lint   # فحص eslint
```

## العلاقة بـ opencode

ينسخ opendesign آليات [opencode](https://github.com/sst/opencode) v2 (المحللة من الشيفرة المصدرية) لمجال التصميم:

| الآلية | opencode v2 | opendesign |
|---|---|---|
| كتالوج المزودين | models.dev + snapshot مدمج، كاش 5 دقائق | models.dev + كاش قرصي، 24 ساعة |
| المزودون المخصصون | `providers.<id> = {package, settings.baseURL, models}` | `customProviders.<id> = {baseURL, apiKey, env, models}` |
| المصادقة | مخزن SQLite + متغيرات بيئة | ملف إعدادات + متغيرات بيئة |
| حلقة الوكيل | مُشغّل خطوات يدوي بأحداث موحدة | AI SDK `streamText` متعدد الخطوات + نفس نموذج الأحداث |
| MCP | `@modelcontextprotocol/client` 2.0، تسمية `server_tool`، تمرير JSON Schema | `@modelcontextprotocol/sdk` 1.x، نفس التسمية والتمرير |
| وضع الخطة | وكيل `plan` + قواعد منع بصلاحيات | مفتاح Build/Plan؛ تصفية الأدوات المعدِّلة + أداة `write_plan` |
| الذاكرة | لا يوجد في v2 (AGENTS.md فقط) | جلسات محفوظة + أدوات ذاكرة + حقن في البرومبت |
| التخزين | SQLite بأحداث متراكمة | ملفات JSON (بلا تبعيات أصلية) |

## واجهات API

| المسار | الغرض |
|---|---|
| `POST /api/chat` | بث SSE للوكيل (إنشاء جلسة، رسالة المستخدم، أجزاء المساعد) |
| `GET /api/sessions`، `GET/PATCH/DELETE /api/sessions/:id` | إدارة الجلسات |
| `GET /api/providers` | كتالوج المزودين/النماذج الكامل مع حالة المفاتيح |
| `POST /api/providers/test` | اختبار endpoint/مفتاح بجلب قائمة النماذج |
| `GET/PUT /api/settings` | الإعدادات (المفاتيح للكتابة فقط؛ GET لا يعيدها أبداً) |
| `GET/POST /api/mcp` | حالات خوادم MCP وأدواتها / إعادة تحميل |
| `GET/POST/DELETE /api/memory` | مخزن الذاكرة |
| `POST /api/editor/ensure` | (اختياري) تشغيل محرر OpenFigma المجاور إن وُجد |

## الترخيص

MIT
