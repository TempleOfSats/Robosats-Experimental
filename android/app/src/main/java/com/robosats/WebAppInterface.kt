package com.robosats

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.util.Log
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

class WebAppInterface(
    private val context: MainActivity,
    private val webView: WebView
) {
    private val webSockets = ConcurrentHashMap<String, WebSocket>()
    private val closedBeforeOpen = ConcurrentHashMap.newKeySet<String>()
    private val storageKey = Regex("^[A-Za-z0-9_.:-]{1,128}$")

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
            "garage_slots", "federation_relays", "federation_pubkeys" -> NostrClient.refresh()
            "settings_notifications" -> updateNotificationService(value == "true")
        }
    }

    @JavascriptInterface
    fun deleteStorage(key: String) {
        if (!storageKey.matches(key)) return
        EncryptedStorage.deleteEncryptedStorage(key)
        if (key == "garage_slots") NostrClient.refresh()
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
        val networkAvailable = context.getSystemService(ConnectivityManager::class.java).activeNetwork != null
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
            .put("networkAvailable", networkAvailable)
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
    fun httpRequest(
        requestId: String,
        method: String,
        url: String,
        headersJson: String,
        body: String
    ) {
        if (!isIdentifier(requestId) || !isHttpUrl(url)) {
            reject(requestId, "Invalid native HTTP request")
            return
        }

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
                if (status !is TorStatus.Active) {
                    reject(requestId, (status as? TorStatus.Failed)?.reason ?: "Tor is not ready")
                    return@launch
                }

                runCatching { NativeNetworkClient.requireClient() }
                    .onSuccess { client ->
                        client.newCall(request).enqueue(object : Callback {
                            override fun onFailure(call: Call, e: IOException) {
                                reject(requestId, e.message ?: "Tor request failed")
                                context.recoverTransportAfterFailure()
                            }

                            override fun onResponse(call: Call, response: Response) {
                                response.use {
                                    val responseHeaders = JSONObject()
                                    response.headers.names().forEach { name ->
                                        responseHeaders.put(name.lowercase(), response.headers.values(name).joinToString(", "))
                                    }
                                    val result = JSONObject()
                                        .put("status", response.code)
                                        .put("headers", responseHeaders)
                                        .put("body", response.body.string())
                                    resolve(requestId, result)
                                }
                            }
                        })
                    }
                    .onFailure { error ->
                        Log.e(TAG, "Native HTTP request could not acquire Tor client", error)
                        reject(requestId, error.message ?: "Tor request failed")
                        context.recoverTransportAfterFailure()
                    }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Native HTTP request failed", error)
            reject(requestId, error.message ?: "Tor request failed")
        }
    }

    @JavascriptInterface
    fun openWebSocket(socketId: String, url: String, protocolsJson: String) {
        if (!isIdentifier(socketId) || !isWebSocketUrl(url)) {
            webSocketError(socketId, "Invalid WebSocket request")
            return
        }
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
                        Log.d(TAG, "Native Tor WebSocket opened")
                        evaluate("window.__robosatsNativeTransport?.webSocketOpen(${quote(socketId)}, ${quote(response.header("Sec-WebSocket-Protocol") ?: "")})")
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        evaluate("window.__robosatsNativeTransport?.webSocketMessage(${quote(socketId)}, ${quote(text)})")
                    }

                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                        evaluate("window.__robosatsNativeTransport?.webSocketMessage(${quote(socketId)}, ${quote(bytes.base64())})")
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        evaluate("window.__robosatsNativeTransport?.webSocketClosing(${quote(socketId)}, $code, ${quote(reason)})")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        webSockets.remove(socketId)
                        Log.d(TAG, "Native Tor WebSocket closed: $code")
                        evaluate("window.__robosatsNativeTransport?.webSocketClosed(${quote(socketId)}, $code, ${quote(reason)})")
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        webSockets.remove(socketId)
                        Log.w(TAG, "Native Tor WebSocket failed: ${t.message}")
                        webSocketError(socketId, t.message ?: "WebSocket failed")
                        context.recoverTransportAfterFailure()
                    }
                        }
                    )
                }.onSuccess { socket ->
                    webSockets[socketId] = socket
                    if (closedBeforeOpen.remove(socketId)) {
                        webSockets.remove(socketId)?.cancel()
                    }
                }.onFailure { error ->
                    Log.w(TAG, "Native Tor WebSocket could not acquire Tor client", error)
                    webSocketError(socketId, error.message ?: "WebSocket failed")
                    context.recoverTransportAfterFailure()
                }
            }
        } catch (error: Throwable) {
            webSocketError(socketId, error.message ?: "WebSocket failed")
        }
    }

    @JavascriptInterface
    fun sendWebSocket(socketId: String, message: String): Boolean =
        webSockets[socketId]?.send(message) ?: false

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

    fun closeAll() {
        webSockets.values.forEach { it.cancel() }
        webSockets.clear()
        closedBeforeOpen.clear()
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
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun quote(value: String): String = JSONObject.quote(value)
    private fun isIdentifier(value: String) = value.matches(Regex("^[A-Za-z0-9_-]{1,96}$"))
    private fun isHttpUrl(value: String) = runCatching { value.toUri().scheme in setOf("http", "https") }.getOrDefault(false)
    private fun isWebSocketUrl(value: String) = runCatching { value.toUri().scheme in setOf("ws", "wss") }.getOrDefault(false)

    companion object {
        private const val TAG = "RoboSatsBridge"
    }
}
