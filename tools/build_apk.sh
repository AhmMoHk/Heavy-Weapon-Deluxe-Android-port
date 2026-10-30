#!/bin/bash
# Build the Android APK: javac -> dx -> aapt package -> add dex -> zipalign -> apksigner
set -euo pipefail
unset JAVA_TOOL_OPTIONS
ROOT=/home/claude/hw
AND=$ROOT/android
OUT=$ROOT/out
JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
mkdir -p $OUT
rm -rf $OUT/obj $OUT/dex $OUT/apkroot && mkdir -p $OUT/obj $OUT/dex $OUT/apkroot/assets
# assets: the web game
rsync -a --delete $ROOT/build/www/ $OUT/apkroot/assets/www/
javac -nowarn -source 8 -target 8 -bootclasspath $JAR -classpath $JAR -d $OUT/obj $(find $AND/src -name '*.java') 2>&1 | grep -v -E "^warning|bootstrap|^1 warning|source value 8|target value 8|To suppress" || true
dalvik-exchange --dex --min-sdk-version=21 --output=$OUT/dex/classes.dex $OUT/obj
# -0 ogg/png etc: store media uncompressed (already compressed; also lets MediaPlayer openFd() them)
aapt package -f -M $AND/AndroidManifest.xml -S $AND/res -A $OUT/apkroot/assets -I $JAR \
   -0 ogg -0 png -0 jpg -0 mp4 -0 arsc --min-sdk-version 21 --target-sdk-version 34 \
   -F $OUT/hw.unsigned.apk
(cd $OUT/dex && aapt add $OUT/hw.unsigned.apk classes.dex > /dev/null)
zipalign -f -p 4 $OUT/hw.unsigned.apk $OUT/hw.aligned.apk
if [ ! -f $ROOT/keystore.jks ]; then
  keytool -genkeypair -keystore $ROOT/keystore.jks -storepass hwport123 -keypass hwport123 -alias hw \
    -keyalg RSA -keysize 2048 -validity 20000 -dname "CN=Heavy Weapon Port, O=Personal, C=IQ" > /dev/null 2>&1
fi
apksigner sign --ks $ROOT/keystore.jks --ks-pass pass:hwport123 --key-pass pass:hwport123 --ks-key-alias hw \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --min-sdk-version 21 \
  --out $OUT/HeavyWeapon.apk $OUT/hw.aligned.apk
apksigner verify --verbose $OUT/HeavyWeapon.apk | head -8
ls -la $OUT/HeavyWeapon.apk
