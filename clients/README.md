# Native TV previews

These are development clients for the I/O server API in this checkout. They are not store releases or hardware-certified apps. Run the matching server version before pairing. The server address is entered on the TV; approve the displayed code on an already signed-in phone/computer and choose a profile. PIN-protected profiles require their PIN. Revoke native devices in I/O's TV settings.

The shared API provides profile-bound enrollment, paginated library browsing, title/episode selection, HLS playback with quality and audio-track choices and saved playback position. Tokens are separate from account sessions and cannot access account settings. Android encrypts its token with Android Keystore; Apple uses Keychain; Roku uses its app's private registry. Registrations expire after 90 days of inactivity. Playback access is limited to the device's requested streams and rechecks profile restrictions.

## Android / Google TV / Fire TV

Open `android-tv` in Android Studio, or use Gradle 8.14.6 and JDK 17+ with the Android 36.1 SDK. Create `local.properties` pointing at your SDK. Run `gradle assembleDebug`. A normal Android debug key is used; optionally set `IO_ANDROID_DEBUG_KEYSTORE` to an existing debug keystore.

The debug APK builds successfully on Windows. It has not been installed or played on hardware. Minimum Android API is 23; older Fire TV devices are unsupported. Fire OS compatibility, remote focus, screen lifecycle, codecs, subtitles, casting and store compliance need device testing. Do not use the public debug signing key for a production release.

## Roku

Run `npx --package=brighterscript bsc --project clients/roku/bsconfig.json` from the repository root. The package is for developer sideloading onto your own Roku. Device developer enrollment and packaging/signing for distribution must be done by the owner. Roku registry contents are not included in source packages.

## Apple TV

On a Mac with Xcode and XcodeGen, run `xcodegen generate` inside `apple-tv`, open the generated project, select your own signing team, and build for tvOS 17+. No Apple signing credentials are included. The source has not been compiled on Windows or tested on an Apple TV. Local HTTP connectivity depends on Apple transport/local-network permissions; HTTPS is recommended for a stable installation.

All clients currently use the first configured server and the single approved profile. Changing profiles requires a new approval. Public HTTPS is required by the clients for non-local server addresses. The server's native API and stream-cookie behavior are covered by automated tests; this does not substitute for platform tests.

References: [Android Media3](https://developer.android.com/media/media3/exoplayer/hello-world), [Android TV](https://developer.android.com/training/tv/get-started/create), [Roku HTTP agents](https://developer.roku.com/dev/docs/ifsgnodehttpagentaccess), [Apple AVURLAsset cookies](https://developer.apple.com/documentation/avfoundation/avurlassethttpcookieskey).
