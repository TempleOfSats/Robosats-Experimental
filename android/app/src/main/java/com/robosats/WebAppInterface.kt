package com.robosats

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Base64
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import com.robosats.models.EncryptedStorage
import com.robosats.models.NostrClient
import com.robosats.net.NativeNetworkClient
import com.robosats.tor.ArtiNative
import com.robosats.tor.ArtiTorManager
import com.robosats.tor.TorStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class WebAppInterface(
    private val context: MainActivity,
    private val webView: WebView
) {
    private val httpCalls = ConcurrentHashMap<String, Call>()
    private val cancelledBeforeStart = ConcurrentHashMap.newKeySet<String>()
    private val webSockets = ConcurrentHashMap<String, WebSocket>()
    private val closedBeforeOpen = ConcurrentHashMap.newKeySet<String>()
    private val storageKey = Regex("^[A-Za-z0-9_.:-]{1,128}$")
    private val foreground = AtomicBoolean(true)
    private val transportGeneration = AtomicLong(0L)

    @JavascriptInterface
    fun getStorage(key: String): String? {
        if (!storageKey.matches(key)) return null
        return EncryptedStorage.getEncryptedStorageOrNull(key)
    }

    @JavascriptInterface
    fun setStorage(key: String, value: String) {
        if (!storageKey.matches(key)) return
        EncryptedStorage.setEncryptedStorage(key, value)
        when (key) {
            "robosats_exp_garage_slots_v1" -> NostrClient.refreshGarage(value)
            "federation_relays", "federation_pubkeys" -> NostrClient.refresh()
            "settings_notifications" -> updateNotificationService(value == "true")
        }
    }

    @JavascriptInterface
    fun deleteStorage(key: String) {
        if (!storageKey.matches(key)) return
        EncryptedStorage.deleteEncryptedStorage(key)
        if (key == "robosats_exp_garage_slots_v1") NostrClient.refreshGarage("")
    }

    @JavascriptInterface
    fun getTorStatus(): String = when (ArtiTorManager.status.value) {
        is TorStatus.Active -> "ACTIVE"
        is TorStatus.Connecting -> "CONNECTING"
        is TorStatus.Failed -> "FAILED"
        TorStatus.Off -> "OFF"
    }

    @JavascriptInterface
    fun getTorDiagnostics(): String {
        val status = ArtiTorManager.status.value
        val state = when (status) {
            is TorStatus.Active -> "connected"
            is TorStatus.Connecting -> "connecting"
            is TorStatus.Failed -> "failed"
            TorStatus.Off -> "off"
        }
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val recovery = (context.application as RoboSatsApplication).networkRecovery.diagnostics()
        return JSONObject()
            .put("connected", status is TorStatus.Active)
            .put("state", state)
            .put("socksHost", if (status is TorStatus.Active) "127.0.0.1" else JSONObject.NULL)
            .put("socksPort", (status as? TorStatus.Active)?.port ?: JSONObject.NULL)
            .put("implementation", "Arti")
            .put("artiVersion", runCatching { ArtiNative.getVersion() }.getOrDefault("Unavailable"))
            .put("bootstrapProgress", (status as? TorStatus.Connecting)?.progress ?: if (status is TorStatus.Active) 100 else 0)
            .put("clientInitialized", ArtiTorManager.isInitialized())
            .put("proxyRunning", ArtiTorManager.isProxyRunning())
            .put("networkAvailable", Connectivity.isValidated)
            .put("networkHandoffPending", recovery.handoffPending)
            .put("networkEpoch", recovery.epoch)
            .put("networkCompletedEpoch", recovery.completedEpoch)
            .put("networkRecoveryCount", recovery.recoveryCount)
            .put("routing", "Native HTTP and WebSocket traffic through Tor")
            .put("appVersion", packageInfo.versionName ?: "Unknown")
            .put("error", (status as? TorStatus.Failed)?.reason ?: JSONObject.NULL)
            .toString()
    }

    @JavascriptInterface
    fun getNotificationState(): String = context.notificationState().toString()

    @JavascriptInterface
    fun setNotificationsEnabled(enabled: Boolean) {
        context.setNotificationsEnabled(enabled)
    }

    @JavascriptInterface
    fun performHaptic(intent: String) {
        val feedback = when (intent) {
            "selection" -> HapticFeedbackConstants.CLOCK_TICK
            "commit" -> HapticFeedbackConstants.KEYBOARD_TAP
            "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.VIRTUAL_KEY
            }
            "reject" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.CONTEXT_CLICK
            }
            else -> return
        }
        webView.post { webView.performHapticFeedback(feedback) }
    }

    @JavascriptInterface
    fun recoverTorTransport() {
        context.recoverTransportAfterFailure(forceRebuild = true)
    }

    @JavascriptInterface
    fun reconnectTorTransport() {
        context.reconnectTorTransport()
    }

    @JavascriptInterface
    fun resetTorTransport() {
        context.resetTorTransport()
    }

    @JavascriptInterface
    fun httpRequest(
        requestId: String,
        method: String,
        url: String,
        headersJson: String,
        body: String
    ) {
        if (!foreground.get()) return
        if (!isIdentifier(requestId) || !isHttpUrl(url)) {
            reject(requestId, "Invalid native HTTP request")
            return
        }
        val generation = transportGeneration.get()

        try {
            val headers = JSONObject(headersJson.ifBlank { "{}" })
            val requestBuilder = Request.Builder().url(url)
            val names = headers.keys()
            while (names.hasNext()) {
                val name = names.next()
                if (!name.equals("host", true) && !name.equals("content-length", true)) {
                    requestBuilder.header(name, headers.optString(name))
                }
            }

            val normalizedMethod = method.uppercase()
            val contentType = headers.optString("Content-Type", "application/json; charset=utf-8")
            val requestBody = body.toRequestBody(contentType.toMediaTypeOrNull())
            when (normalizedMethod) {
                "GET" -> requestBuilder.get()
                "HEAD" -> requestBuilder.head()
                "DELETE" -> if (body.isEmpty()) requestBuilder.delete() else requestBuilder.delete(requestBody)
                "POST" -> requestBuilder.post(requestBody)
                "PUT" -> requestBuilder.put(requestBody)
                "PATCH" -> requestBuilder.patch(requestBody)
                else -> {
                    reject(requestId, "Unsupported HTTP method")
                    return
                }
            }

            val request = requestBuilder.build()
            context.lifecycleScope.launch(Dispatchers.IO) {
                val status = ArtiTorManager.start(context.applicationContext)
                if (!isCurrent(generation)) return@launch
                if (status !is TorStatus.Active) {
                    reject(requestId, (status as? TorStatus.Failed)?.reason ?: "Tor is not ready")
                    return@launch
                }

                runCatching { NativeNetworkClient.requireClient() }
                    .onSuccess { client ->
                        val call = client.newCall(request)
                        if (!isCurrent(generation) || cancelledBeforeStart.remove(requestId)) {
                            call.cancel()
                            return@onSuccess
                        }
                        httpCalls[requestId] = call
                        call.enqueue(object : Callback {
                            override fun onFailure(call: Call, e: IOException) {
                                if (!httpCalls.remove(requestId, call)) return
                                reject(requestId, e.message ?: "Tor request failed")
                            }

                            override fun onResponse(call: Call, response: Response) {
                                if (httpCalls[requestId] !== call) {
                                    response.close()
                                    return
                                }
                                try {
                                    response.use {
                                        val responseHeaders = JSONObject()
                                        response.headers.names().forEach { name ->
                                            responseHeaders.put(name.lowercase(), response.headers.values(name).joinToString(", "))
                                        }
                                        val result = JSONObject()
                                            .put("status", response.code)
                                            .put("headers", responseHeaders)
                                            .put("body", response.body.string())
                                        if (httpCalls.remove(requestId, call)) resolve(requestId, result)
                                    }
                                } catch (error: Throwable) {
                                    if (!httpCalls.remove(requestId, call)) return
                                    reject(requestId, error.message ?: "Tor response failed")
                                }
                            }
                        })
                    }
                    .onFailure { error ->
                        if (!isCurrent(generation)) return@onFailure
                        Log.e(TAG, "Native HTTP request could not acquire Tor client", error)
                        reject(requestId, error.message ?: "Tor request failed")
                    }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Native HTTP request failed", error)
            reject(requestId, error.message ?: "Tor request failed")
        }
    }

    @JavascriptInterface
    fun cancelHttpRequest(requestId: String) {
        if (!isIdentifier(requestId)) return
        val call = httpCalls.remove(requestId)
        if (call == null) cancelledBeforeStart.add(requestId) else call.cancel()
    }

    @JavascriptInterface
    fun openWebSocket(socketId: String, url: String, protocolsJson: String) {
        if (!foreground.get()) return
        if (!isIdentifier(socketId) || !isWebSocketUrl(url)) {
            webSocketError(socketId, "Invalid WebSocket request")
            return
        }
        val generation = transportGeneration.get()
        closedBeforeOpen.remove(socketId)

        try {
            val request = Request.Builder().url(url).apply {
                val protocols = runCatching { org.json.JSONArray(protocolsJson) }.getOrNull()
                if (protocols != null && protocols.length() > 0) {
                    val values = (0 until protocols.length()).map { protocols.getString(it) }
                    header("Sec-WebSocket-Protocol", values.joinToString(", "))
                }
            }.build()

            context.lifecycleScope.launch(Dispatchers.IO) {
                val status = ArtiTorManager.start(context.applicationContext)
                if (!isCurrent(generation)) return@launch
                if (status !is TorStatus.Active) {
                    webSocketError(socketId, (status as? TorStatus.Failed)?.reason ?: "Tor is not ready")
                    return@launch
                }
                if (closedBeforeOpen.remove(socketId)) return@launch

                runCatching {
                    NativeNetworkClient.requireClient().newWebSocket(
                        request,
                        object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        if (!isCurrentSocket(generation, socketId, webSocket)) {
                            webSocket.cancel()
                            return
                        }
                        Log.d(TAG, "Native Tor WebSocket opened")
                        evaluate("window.__robosatsNativeTransport?.webSocketOpen(${quote(socketId)}, ${quote(response.header("Sec-WebSocket-Protocol") ?: "")})")
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (!isCurrentSocket(generation, socketId, webSocket)) return
                        evaluate("window.__robosatsNativeTransport?.webSocketMessage(${quote(socketId)}, ${quote(text)})")
                    }

                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                        if (!isCurrentSocket(generation, socketId, webSocket)) return
                        evaluate("window.__robosatsNativeTransport?.webSocketMessage(${quote(socketId)}, ${quote(bytes.base64())})")
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        if (!isCurrentSocket(generation, socketId, webSocket)) return
                        evaluate("window.__robosatsNativeTransport?.webSocketClosing(${quote(socketId)}, $code, ${quote(reason)})")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        if (!webSockets.remove(socketId, webSocket) || !isCurrent(generation)) return
                        Log.d(TAG, "Native Tor WebSocket closed: $code")
                        evaluate("window.__robosatsNativeTransport?.webSocketClosed(${quote(socketId)}, $code, ${quote(reason)})")
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        if (!webSockets.remove(socketId, webSocket) || !isCurrent(generation)) return
                        Log.w(TAG, "Native Tor WebSocket failed: ${t.message}")
                        webSocketError(socketId, t.message ?: "WebSocket failed")
                    }
                        }
                    )
                }.onSuccess { socket ->
                    if (!isCurrent(generation)) {
                        socket.cancel()
                        return@onSuccess
                    }
                    webSockets[socketId] = socket
                    if (closedBeforeOpen.remove(socketId)) {
                        webSockets.remove(socketId)?.cancel()
                    }
                }.onFailure { error ->
                    if (!isCurrent(generation)) return@onFailure
                    Log.w(TAG, "Native Tor WebSocket could not acquire Tor client", error)
                    webSocketError(socketId, error.message ?: "WebSocket failed")
                }
            }
        } catch (error: Throwable) {
            webSocketError(socketId, error.message ?: "WebSocket failed")
        }
    }

    @JavascriptInterface
    fun sendWebSocket(socketId: String, message: String): Boolean =
        if (foreground.get()) webSockets[socketId]?.send(message) ?: false else false

    @JavascriptInterface
    fun closeWebSocket(socketId: String, code: Int, reason: String) {
        val socket = webSockets.remove(socketId)
        if (socket == null) {
            closedBeforeOpen.add(socketId)
        } else {
            socket.close(code.coerceIn(1000, 4999), reason.take(123))
        }
    }

    @JavascriptInterface
    fun copyToClipboard(value: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("RoboSats", value))
        Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
    }

    @JavascriptInterface
    fun openExternal(url: String) {
        val uri = runCatching { url.toUri() }.getOrNull() ?: return
        if (uri.scheme !in setOf("http", "https", "lightning", "bitcoin")) return
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    @JavascriptInterface
    fun saveFile(filename: String, mimeType: String, contentBase64: String): Boolean {
        if (contentBase64.length > MAX_BASE64_BYTES || mimeType.length > 128) return false
        val content = runCatching { Base64.decode(contentBase64, Base64.DEFAULT) }.getOrNull() ?: return false
        if (content.size > MAX_FILE_BYTES) return false
        return context.requestFileSave(sanitizeFilename(filename), content)
    }

    fun closeAll() {
        transportGeneration.incrementAndGet()
        httpCalls.values.forEach { it.cancel() }
        httpCalls.clear()
        cancelledBeforeStart.clear()
        webSockets.values.forEach { it.cancel() }
        webSockets.clear()
        closedBeforeOpen.clear()
    }

    fun suspendTransport() {
        Log.d(TAG, "Suspending native transport (${httpCalls.size} HTTP, ${webSockets.size} WebSocket)")
        foreground.set(false)
        closeAll()
    }

    fun resumeTransport() {
        foreground.set(true)
        Log.d(TAG, "Native transport ready after resume")
    }

    private fun updateNotificationService(enabled: Boolean) {
        context.setNotificationsEnabled(enabled)
    }

    private fun resolve(requestId: String, result: JSONObject) {
        evaluate("window.__robosatsNativeTransport?.resolve(${quote(requestId)}, $result)")
    }

    private fun reject(requestId: String, message: String) {
        if (!isIdentifier(requestId)) return
        evaluate("window.__robosatsNativeTransport?.reject(${quote(requestId)}, ${quote(message)})")
    }

    private fun webSocketError(socketId: String, message: String) {
        if (!isIdentifier(socketId)) return
        evaluate("window.__robosatsNativeTransport?.webSocketError(${quote(socketId)}, ${quote(message)})")
    }

    private fun evaluate(script: String) {
        val generation = transportGeneration.get()
        if (!isCurrent(generation)) return
        webView.post {
            if (isCurrent(generation)) webView.evaluateJavascript(script, null)
        }
    }

    private fun isCurrent(generation: Long): Boolean =
        foreground.get() && transportGeneration.get() == generation

    private fun isCurrentSocket(generation: Long, socketId: String, socket: WebSocket): Boolean =
        isCurrent(generation) && webSockets[socketId] === socket

    private fun quote(value: String): String = JSONObject.quote(value)
    private fun isIdentifier(value: String) = value.matches(Regex("^[A-Za-z0-9_-]{1,96}$"))
    private fun isHttpUrl(value: String) = runCatching { value.toUri().scheme in setOf("http", "https") }.getOrDefault(false)
    private fun isWebSocketUrl(value: String) = runCatching { value.toUri().scheme in setOf("ws", "wss") }.getOrDefault(false)

    private fun sanitizeFilename(value: String): String {
        val leaf = value.substringAfterLast('/').substringAfterLast('\\')
        val safe = leaf
            .replace(Regex("[\\u0000-\\u001f<>:\"/\\\\|?*]"), "-")
            .trim()
            .trimEnd('.', ' ')
        return safe.take(160).ifBlank { "robosats-export" }
    }

    companion object {
        private const val TAG = "RoboSatsBridge"
        private const val MAX_FILE_BYTES = 8 * 1024 * 1024
        private const val MAX_BASE64_BYTES = ((MAX_FILE_BYTES + 2) / 3) * 4
    }
}
