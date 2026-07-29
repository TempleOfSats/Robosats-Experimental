# RoboSats identity JNI libraries

The `robohash` source is vendored from
[`RoboSats/robo-identities`](https://github.com/RoboSats/robo-identities) at
commit `c95a9f563bf50377f82665661152ee42097e773c`.

Android-specific changes are limited to building the library as `cdylib`,
removing non-APK targets, and linking with a 16 KB maximum page
size in `build-android.sh`. Keep the JNI function names aligned with
`com.robosats.RoboIdentities`.

Regenerate the browser identity asset pack from this vendored source with:

```sh
npm run generate:robot-identities
```

Set `ROBO_IDENTITIES_SOURCE` to an upstream `robo-identities` checkout when
the nickname dictionaries also need to be refreshed.
