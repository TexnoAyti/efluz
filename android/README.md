# EFLUZ Android

Directly installable Android 7.0+ application (`uz.efluz.app`). It opens the live
EFLUZ HTTPS service, so Internet access is required and website releases appear
without rebuilding the APK. Play Store publication is not required.

## Login

Tap **Telegram orqali kirish**, open the linked private bot chat and press Start
if Telegram asks. Compare the six-digit code, approve, then return to EFLUZ.
The bot callback binds the actual Telegram account to a five-minute device
challenge. Only the requesting WebView receives Secure HttpOnly session cookies.
The website's usual Telegram Mini App authentication remains supported.

## Build

Use Java 17 (including `jdk.compiler`), official Android platform 35 and build
tools 35.0.0. No Gradle, third-party native runtime, or paid build service needed.

Set `ANDROID_HOME`, `ANDROID_BUILD_TOOLS` and `ANDROID_JAR` to those installed
tools. Supply `EFL_ANDROID_KEYSTORE`, `EFL_ANDROID_KEY_ALIAS` and
`EFL_APK_STORE_PASSWORD` privately, then run:

```sh
python3 android/build-apk.py
```

The default output is `artifacts/android/EFLUZ-1.0.1.apk`. Keep the signing key
and password backed up privately; every upgrade must use the same key and a
higher manifest versionCode. Never commit signing material or environment files.

The shell has only the Internet permission. Uploads and exports use the Android
system file picker, and external links open in the user's installed app/browser.
It does not register native push notifications; existing Telegram notifications
continue through the bot. Offline mode shows retry rather than copied user data.

## Verification

```sh
npm run lint
npm run build
node scripts/run-isolated-test.mjs src/server/tests/postgresSqlIntegrationTest.ts
java -m jdk.compiler/com.sun.tools.javac.Main -d /tmp/efluz-android-test android/app/src/main/java/uz/efluz/app/NavigationPolicy.java android/NavigationPolicyTest.java
java -cp /tmp/efluz-android-test NavigationPolicyTest
```

The SQL suite covers real HTTP routes with isolated Telegram transport and native
PostgreSQL transactions, including denied/expired/replayed approval, wrong account
and message, CSRF, rollback, concurrency, refresh and logout. Also test install,
Telegram handoff, persistent login, upload/export, keyboard and Back on a device
before a wider release. A browser test does not replace Android device testing.
