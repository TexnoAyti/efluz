#!/usr/bin/env python3
"""Build a signed EFLUZ APK with the official Android platform/build tools.
Signing credentials are required environment variables and never written to git.
"""
import os, pathlib, shutil, subprocess, tempfile, zipfile, hashlib, json
ROOT=pathlib.Path(__file__).resolve().parent
sdk=pathlib.Path(os.environ['ANDROID_HOME']);tools=pathlib.Path(os.environ.get('ANDROID_BUILD_TOOLS',sdk/'build-tools/35.0.0'));platform=pathlib.Path(os.environ.get('ANDROID_JAR',sdk/'platforms/android-35/android.jar'))
keystore=pathlib.Path(os.environ['EFL_ANDROID_KEYSTORE']);alias=os.environ.get('EFL_ANDROID_KEY_ALIAS','efluz')
if not os.environ.get('EFL_APK_STORE_PASSWORD'):raise SystemExit('EFL_APK_STORE_PASSWORD is required')
output=pathlib.Path(os.environ.get('EFL_ANDROID_OUTPUT',ROOT.parent/'artifacts/android/EFLUZ-1.0.0.apk')).resolve();output.parent.mkdir(parents=True,exist_ok=True)
def run(*args):subprocess.run([str(a) for a in args],check=True)
with tempfile.TemporaryDirectory(prefix='efluz-android-') as temp:
 work=pathlib.Path(temp);generated=work/'generated';classes=work/'classes';dex=work/'dex'
 for folder in [generated,classes,dex]:folder.mkdir()
 run(tools/'aapt2','compile','--dir',ROOT/'app/src/main/res','-o',work/'resources.zip')
 run(tools/'aapt2','link','-I',platform,'--manifest',ROOT/'app/src/main/AndroidManifest.xml','--java',generated,'-o',work/'unsigned.apk',work/'resources.zip')
 sources=list((ROOT/'app/src/main/java').rglob('*.java'))+list(generated.rglob('*.java'))
 run('java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-source','8','-target','8','-classpath',platform,'-d',classes,*sources)
 run(tools/'d8','--lib',platform,'--min-api','24','--output',dex,*classes.rglob('*.class'))
 with zipfile.ZipFile(work/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as apk:
  for bytecode in dex.glob('*.dex'):apk.write(bytecode,bytecode.name)
 run(tools/'zipalign','-f','-p','4',work/'unsigned.apk',work/'aligned.apk')
 run(tools/'apksigner','sign','--ks',keystore,'--ks-key-alias',alias,'--ks-pass','env:EFL_APK_STORE_PASSWORD','--key-pass','env:EFL_APK_STORE_PASSWORD','--v1-signing-enabled','true','--v2-signing-enabled','true','--out',output,work/'aligned.apk')
 run(tools/'apksigner','verify','--verbose','--print-certs',output)
 run(tools/'aapt2','dump','badging',output)
 print(json.dumps({'apk':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
