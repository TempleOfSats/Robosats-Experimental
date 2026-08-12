package com.robosats

import android.Manifest
import android.annotation.SuppressLint
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.animation.LinearInterpolator
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.robosats.models.EncryptedStorage
import com.robosats.models.NotificationPermissionResultAction
import com.robosats.models.NotificationPreferences
import com.robosats.models.NotificationStartupAction
import com.robosats.models.notificationPermissionResultAction
import com.robosats.models.notificationStartupAction
import com.robosats.services.NotificationsService
import com.robosats.tor.ArtiTorManager
import com.robosats.tor.TorNetworkRecoveryEvent
import com.robosats.tor.TorStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.lang.ref.WeakReference
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var loadingContainer: View
    private lateinit var torOrbit: ImageView
    private lateinit var loadingTitleView: TextView
    private lateinit var statusTextView: TextView
    private lateinit var progressTextView: TextView
    private lateinit var loadingProgressBar: ProgressBar
    private lateinit var retryTorButton: Button
    private var bridge: WebAppInterface? = null
    @Volatile
    private var pendingFileContent: ByteArray? = null
    private var pendingOrderPath: String? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var notificationsStartAttempted = false
    private var webAppReady = false
    private var torReady = false
    private var appRevealed = false
    private var presentedTorStatus: TorStatus = TorStatus.Off
    private var displayedProgress = 2f
    private var connectionStartedAt = 0L
    private var displayedMessageIndex = -1
    private var displayedMessage: String? = null
    private var backgroundedAt = 0L
    private var activityResumed = false
    private var resumeRecoveryRunning = false
    private var manualReconnectRunning = false
    private var lastFailureHealthCheckAt = 0L
    private var lastInterruptedNetworkEpoch = -1L

    private val networkRecovery: com.robosats.tor.TorNetworkRecovery
        get() = (application as RoboSatsApplication).networkRecovery

    private val filePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        filePathCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        filePathCallback = null
    }

    private val fileSaver = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val content = pendingFileContent
        pendingFileContent = null
        if (uri == null || content == null) return@registerForActivityResult
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                contentResolver.openOutputStream(uri)?.use { output -> output.write(content) }
                    ?: error("Could not open destination")
            }
            runOnUiThread {
                Toast.makeText(
                    this@MainActivity,
                    if (result.isSuccess) "File saved" else "Could not save file",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        when (notificationPermissionResultAction(granted, notificationsEnabled())) {
            NotificationPermissionResultAction.DISABLE -> NotificationPreferences.setEnabled(false)
            NotificationPermissionResultAction.START_SERVICE -> startNotificationService()
            NotificationPermissionResultAction.NONE -> Unit
        }
        dispatchNotificationState()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        EncryptedStorage.init(this)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        loadingContainer = findViewById(R.id.loadingContainer)
        torOrbit = findViewById(R.id.torOrbit)
        loadingTitleView = findViewById(R.id.loadingTitleView)
        statusTextView = findViewById(R.id.statusTextView)
        progressTextView = findViewById(R.id.progressTextView)
        loadingProgressBar = findViewById(R.id.loadingProgressBar)
        retryTorButton = findViewById(R.id.retryTorButton)
        pendingOrderPath = intent?.getStringExtra("order_id")

        retryTorButton.setOnClickListener {
            retryTorButton.visibility = View.GONE
            connectTor(reset = true)
        }

        setupWebView()
        startLoadingPresentation()

        lifecycleScope.launch {
            ArtiTorManager.status.collect(::renderTorStatus)
        }
        lifecycleScope.launch {
            networkRecovery.events.collect(::handleNetworkRecovery)
        }

        connectTor(reset = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingOrderPath = intent.getStringExtra("order_id")
        navigateToPendingOrder()
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        appInForeground = true
        activeActivity = WeakReference(this)
        webView.onResume()
        bridge?.resumeTransport()
        webView.post {
            if (!activityResumed) return@post
            webView.isFocusableInTouchMode = true
            webView.requestFocus(View.FOCUS_DOWN)
        }
        val pausedAt = backgroundedAt
        if (pausedAt == 0L) return
        backgroundedAt = 0L
        recoverAfterBackground(SystemClock.elapsedRealtime() - pausedAt)
    }

    override fun onPause() {
        activityResumed = false
        appInForeground = false
        if (activeActivity?.get() === this) activeActivity = null
        webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        if (!isChangingConfigurations) {
            backgroundedAt = SystemClock.elapsedRealtime()
            bridge?.suspendTransport()
        }
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && activityResumed && ::webView.isInitialized) {
            webView.post {
                if (activityResumed && hasWindowFocus()) webView.requestFocus(View.FOCUS_DOWN)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_ASSET_HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString RoboSatsExp/0.1"
        }

        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host == APP_ASSET_HOST) {
                    return assetLoader.shouldInterceptRequest(request.url)
                }
                Log.w("RoboSatsWebView", "Blocked direct request to ${request.url.host}")
                return blockedResponse()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == APP_ASSET_HOST) return false
                openExternal(uri)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!webAppReady) Log.i("RoboSatsStartup", "Local web app ready")
                webAppReady = true
                navigateToPendingOrder()
                startNotificationsIfEnabled()
                if (torReady) dispatchTorReady()
                revealAppWhenReady()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) = callback.invoke(origin, false, false)

            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                filePicker.launch(arrayOf("image/*", "text/plain", "application/json"))
                return true
            }

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("RoboSatsWeb", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        bridge = WebAppInterface(this, webView).also {
            webView.addJavascriptInterface(it, "AndroidAppRobosats")
        }
        webView.loadUrl(APP_URL)
    }

    private fun connectTor(reset: Boolean) {
        torReady = false
        connectionStartedAt = SystemClock.elapsedRealtime()
        displayedMessageIndex = -1
        if (!appRevealed) {
            displayedProgress = 2f
            renderDisplayedProgress()
        }
        lifecycleScope.launch {
            val status = if (reset) {
                ArtiTorManager.reset(applicationContext, clearState = false)
            } else {
                ArtiTorManager.start(applicationContext)
            }
            if (status is TorStatus.Active && !networkRecovery.handoffPending) {
                torReady = true
                Log.i("RoboSatsStartup", "Tor proxy ready")
                dispatchTorReady()
                revealAppWhenReady()
            }
        }
    }

    private fun renderTorStatus(status: TorStatus) {
        presentedTorStatus = status
        when (status) {
            TorStatus.Off -> {
                if (!appRevealed) updateStatusAnimated(getString(R.string.preparing_tor))
            }
            is TorStatus.Connecting -> {
                loadingTitleView.setText(R.string.private_connection_title)
                retryTorButton.visibility = View.GONE
            }
            is TorStatus.Active -> {
                updateStatusAnimated(getString(R.string.loading_app))
                retryTorButton.visibility = View.GONE
            }
            is TorStatus.Failed -> {
                loadingTitleView.setText(R.string.private_connection_failed)
                progressTextView.text = ""
                updateStatusAnimated(getString(R.string.tor_retry_message))
                retryTorButton.visibility = View.VISIBLE
            }
        }
    }

    private fun startLoadingPresentation() {
        ObjectAnimator.ofFloat(torOrbit, View.ROTATION, 0f, 360f).apply {
            duration = 5200L
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            start()
        }

        lifecycleScope.launch {
            while (isActive) {
                when (val status = presentedTorStatus) {
                    TorStatus.Off -> moveDisplayedProgressToward(2f, 0.25f)
                    is TorStatus.Connecting -> {
                        val elapsed = SystemClock.elapsedRealtime() - connectionStartedAt
                        val nativeProgress = status.progress.coerceIn(0, 99).toFloat()
                        val target = max(nativeProgress, syntheticProgress(elapsed))
                        moveDisplayedProgressToward(target, 0.7f)
                        showCycledConnectionMessage(elapsed)
                    }
                    is TorStatus.Active -> {
                        moveDisplayedProgressToward(100f, 2.4f)
                        if (displayedProgress >= 99.5f && !networkRecovery.handoffPending) {
                            revealAppWhenReady()
                        }
                    }
                    is TorStatus.Failed -> Unit
                }
                delay(PROGRESS_TICK_MS)
            }
        }
    }

    // Presentation-only progress between Arti milestones; it never unlocks networking.
    private fun syntheticProgress(elapsedMs: Long): Float {
        val seconds = elapsedMs.coerceAtLeast(0L) / 1000f
        return when {
            seconds < 4f -> lerp(2f, 15f, seconds / 4f)
            seconds < 10f -> lerp(15f, 38f, (seconds - 4f) / 6f)
            seconds < 24f -> lerp(38f, 62f, (seconds - 10f) / 14f)
            seconds < 45f -> lerp(62f, 70f, (seconds - 24f) / 21f)
            else -> 70f
        }
    }

    private fun lerp(start: Float, end: Float, fraction: Float) =
        start + (end - start) * fraction.coerceIn(0f, 1f)

    private fun moveDisplayedProgressToward(target: Float, maxStep: Float) {
        if (target <= displayedProgress) return
        val distance = target - displayedProgress
        displayedProgress += min(distance, max(0.14f, min(maxStep, distance * 0.08f)))
        renderDisplayedProgress()
    }

    private fun renderDisplayedProgress() {
        val progress = displayedProgress.roundToInt().coerceIn(0, 100)
        if (loadingProgressBar.progress != progress) {
            loadingProgressBar.setProgress(progress, true)
            progressTextView.text = getString(R.string.tor_progress, progress)
        }
    }

    private fun showCycledConnectionMessage(elapsedMs: Long) {
        val messages = listOf(
            R.string.tor_message_protecting_identity,
            R.string.tor_message_contacting_network,
            R.string.tor_message_selecting_relays,
            R.string.tor_message_building_circuit,
            R.string.tor_message_checking_route,
            R.string.tor_message_preparing_exchange
        )
        val index = ((elapsedMs / MESSAGE_CYCLE_MS) % messages.size).toInt()
        if (index == displayedMessageIndex) return
        displayedMessageIndex = index
        updateStatusAnimated(getString(messages[index]))
    }

    private fun updateStatusAnimated(message: String) {
        if (displayedMessage == message) return
        displayedMessage = message
        statusTextView.animate().cancel()
        statusTextView.animate()
            .alpha(0f)
            .setDuration(STATUS_FADE_MS)
            .withEndAction {
                statusTextView.text = message
                statusTextView.animate()
                    .alpha(1f)
                    .setDuration(STATUS_FADE_MS)
                    .start()
            }
            .start()
    }

    private fun dispatchTorReady() {
        if (!webAppReady || !activityResumed) return
        webView.post {
            if (!activityResumed) return@post
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('robosats:tor-reconnected'));window.dispatchEvent(new CustomEvent('robosats:tor-ready'))",
                null
            )
        }
    }

    private fun handleNetworkRecovery(event: TorNetworkRecoveryEvent) {
        when (event) {
            is TorNetworkRecoveryEvent.Unavailable -> interruptTransportForNetwork(event.epoch)
            is TorNetworkRecoveryEvent.Reconnecting -> {
                interruptTransportForNetwork(event.epoch)
                updateStatusAnimated(getString(R.string.reconnecting_tor))
            }
            is TorNetworkRecoveryEvent.Completed -> {
                if (event.epoch < lastInterruptedNetworkEpoch) return
                torReady = event.status is TorStatus.Active
                dispatchNativeResume(0L, transportRefreshed = true)
                if (torReady) {
                    dispatchTorReady()
                    revealAppWhenReady()
                }
            }
        }
    }

    private fun interruptTransportForNetwork(epoch: Long) {
        if (epoch <= lastInterruptedNetworkEpoch) return
        lastInterruptedNetworkEpoch = epoch
        torReady = false
        bridge?.closeAll()
        if (!webAppReady || !activityResumed) return
        webView.post {
            if (!activityResumed) return@post
            webView.evaluateJavascript(
                "window.__robosatsNativeTransport?.reset('Android network changed')",
                null,
            )
        }
    }

    private fun recoverAfterBackground(backgroundDurationMs: Long) {
        if (!webAppReady) return
        Log.d("RoboSatsLifecycle", "Resuming after ${backgroundDurationMs}ms in background")
        dispatchNativeResume(
            backgroundDurationMs,
            transportRefreshed = false,
            resetTransport = true
        )
        if (backgroundDurationMs < TRANSPORT_HEALTH_CHECK_AFTER_MS) return
        runTransportHealthCheck(backgroundDurationMs)
    }

    fun recoverTransportAfterFailure(forceRebuild: Boolean = false) {
        lifecycleScope.launch {
            if (manualReconnectRunning || resumeRecoveryRunning) return@launch
            val now = SystemClock.elapsedRealtime()
            if (now - lastFailureHealthCheckAt < FAILURE_HEALTH_CHECK_COOLDOWN_MS) return@launch
            lastFailureHealthCheckAt = now
            if (forceRebuild) {
                resumeRecoveryRunning = true
                try {
                    applyRebuiltTransport(
                        ArtiTorManager.recoverAfterEndToEndFailure(applicationContext)
                    )
                } finally {
                    resumeRecoveryRunning = false
                }
            } else {
                runTransportHealthCheck(backgroundDurationMs = 0L)
            }
        }
    }

    fun reconnectTorTransport() {
        rebuildTorTransport(clearState = false)
    }

    fun resetTorTransport() {
        rebuildTorTransport(clearState = true)
    }

    private fun rebuildTorTransport(clearState: Boolean) {
        lifecycleScope.launch {
            if (manualReconnectRunning) return@launch
            manualReconnectRunning = true
            try {
                updateStatusAnimated(getString(R.string.rebuilding_tor_circuits))
                applyRebuiltTransport(
                    ArtiTorManager.reset(applicationContext, clearState = clearState)
                )
            } finally {
                manualReconnectRunning = false
            }
        }
    }

    private fun applyRebuiltTransport(status: TorStatus) {
        torReady = status is TorStatus.Active
        bridge?.closeAll()
        dispatchNativeResume(0L, transportRefreshed = true, resetTransport = true)
        if (torReady) dispatchTorReady()
    }

    private fun runTransportHealthCheck(backgroundDurationMs: Long) {
        if (manualReconnectRunning || resumeRecoveryRunning) return
        resumeRecoveryRunning = true
        lifecycleScope.launch {
            try {
                val result = ArtiTorManager.recoverAfterResume(applicationContext)
                torReady = result.status is TorStatus.Active
                if (result.transportRebuilt) {
                    lastFailureHealthCheckAt = SystemClock.elapsedRealtime()
                    bridge?.closeAll()
                    dispatchNativeResume(
                        backgroundDurationMs,
                        transportRefreshed = true,
                        resetTransport = true
                    )
                    if (torReady) dispatchTorReady()
                }
            } finally {
                resumeRecoveryRunning = false
            }
        }
    }

    private fun dispatchNativeResume(
        backgroundDurationMs: Long,
        transportRefreshed: Boolean,
        resetTransport: Boolean = false
    ) {
        if (!webAppReady || !activityResumed) return
        val detail = JSONObject()
            .put("backgroundMs", backgroundDurationMs)
            .put("transportRefreshed", transportRefreshed)
            .put("torReady", torReady)
        val reset = if (resetTransport) {
            "window.__robosatsNativeTransport?.reset('Android app resumed');"
        } else {
            ""
        }
        webView.post {
            if (!activityResumed) return@post
            webView.evaluateJavascript(
                "$reset window.dispatchEvent(new CustomEvent('robosats:native-resume', {detail: $detail}))",
                null
            )
        }
    }

    private fun dispatchNativeOrderHint(orderId: String?) {
        if (!webAppReady || !activityResumed) return
        val detail = JSONObject().put("orderId", orderId)
        webView.post {
            if (!activityResumed) return@post
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('robosats:native-order-hint', {detail: $detail}))",
                null
            )
        }
    }

    private fun revealAppWhenReady() {
        if (appRevealed || !webAppReady || !torReady || displayedProgress < 99.5f) return
        appRevealed = true
        webView.visibility = View.VISIBLE
        webView.alpha = 0f
        webView.animate().alpha(1f).setDuration(180L).start()
        loadingContainer.animate()
            .alpha(0f)
            .setDuration(180L)
            .withEndAction {
                loadingContainer.visibility = View.GONE
                loadingContainer.alpha = 1f
            }
            .start()
    }

    private fun navigateToPendingOrder() {
        val raw = pendingOrderPath?.trim()?.trim('/') ?: return
        if (raw.isEmpty() || !::webView.isInitialized) return
        val segments = raw.split('/').filter { it.isNotBlank() }
        val route = when {
            segments.size >= 2 -> "/order/${segments[segments.size - 2]}/${segments.last()}"
            else -> "/order/${segments.last()}"
        }
        webView.evaluateJavascript("window.location.hash=${JSONObject.quote("#$route")}", null)
        pendingOrderPath = null
    }

    private fun openExternal(uri: Uri) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { Log.w("RoboSatsWebView", "No app can open $uri", it) }
    }

    fun requestFileSave(filename: String, content: ByteArray): Boolean {
        if (pendingFileContent != null || isFinishing || isDestroyed) return false
        pendingFileContent = content
        runOnUiThread {
            if (pendingFileContent !== content || isFinishing || isDestroyed) return@runOnUiThread
            runCatching { fileSaver.launch(filename) }
                .onFailure {
                    pendingFileContent = null
                    Toast.makeText(this, "Could not open save dialog", Toast.LENGTH_SHORT).show()
                }
        }
        return true
    }

    private fun blockedResponse() = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Direct network access is disabled",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0))
    )

    private fun startNotificationsIfEnabled() {
        when (notificationStartupAction(notificationsStartAttempted, notificationsEnabled(), notificationPermissionGranted())) {
            NotificationStartupAction.NONE -> Unit
            NotificationStartupAction.START_SERVICE -> startNotificationService()
            NotificationStartupAction.REQUEST_PERMISSION -> {
                notificationsStartAttempted = true
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    fun setNotificationsEnabled(enabled: Boolean) {
        runOnUiThread {
            NotificationPreferences.setEnabled(enabled)
            if (!enabled) {
                notificationsStartAttempted = false
                stopService(Intent(this, NotificationsService::class.java))
                dispatchNotificationState()
            } else if (notificationPermissionGranted()) {
                startNotificationService()
                dispatchNotificationState()
            } else {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    fun notificationState(): JSONObject = JSONObject()
        .put("enabled", notificationsEnabled())
        .put("permissionGranted", notificationPermissionGranted())
        .put("permissionRequired", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)

    private fun notificationsEnabled() =
        NotificationPreferences.areEnabled()

    private fun notificationPermissionGranted() =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun startNotificationService() {
        notificationsStartAttempted = true
        runCatching {
            ContextCompat.startForegroundService(this, Intent(this, NotificationsService::class.java))
        }.onFailure {
            notificationsStartAttempted = false
            Log.w("RobosatsNotifications", "Background notifications could not start", it)
        }
    }

    private fun dispatchNotificationState() {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('robosats:native-notification-state'))",
                null
            )
        }
    }

    override fun onDestroy() {
        bridge?.closeAll()
        pendingFileContent = null
        webView.removeJavascriptInterface("AndroidAppRobosats")
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        @Volatile
        private var activeActivity: WeakReference<MainActivity>? = null
        @Volatile
        private var appInForeground = false

        fun isAppInForeground(): Boolean = appInForeground

        fun dispatchOrderHint(orderId: String?) {
            activeActivity?.get()?.dispatchNativeOrderHint(orderId)
        }

        private const val APP_ASSET_HOST = "appassets.androidplatform.net"
        private const val APP_URL = "https://$APP_ASSET_HOST/index.html"
        private const val PROGRESS_TICK_MS = 80L
        private const val MESSAGE_CYCLE_MS = 3800L
        private const val STATUS_FADE_MS = 160L
        private const val TRANSPORT_HEALTH_CHECK_AFTER_MS = 3 * 60_000L
        private const val FAILURE_HEALTH_CHECK_COOLDOWN_MS = 15_000L
    }
}
