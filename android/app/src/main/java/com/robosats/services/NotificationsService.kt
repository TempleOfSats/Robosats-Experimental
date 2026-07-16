package com.robosats.services

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationChannelGroupCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.createBitmap
import com.robosats.Connectivity
import com.robosats.MainActivity
import com.robosats.R
import com.robosats.RoboIdentities
import com.robosats.models.EncryptedStorage
import com.robosats.models.NostrClient
import com.robosats.models.NostrClient.garagePubKeys
import com.robosats.models.NostrClient.getRobotKeyPair
import com.robosats.tor.ArtiTorManager
import com.robosats.tor.TorStatus
import com.vitorpamplona.ammolite.relays.Client
import com.vitorpamplona.ammolite.relays.Relay
import com.vitorpamplona.quartz.events.ChatMessageEvent
import com.vitorpamplona.quartz.events.Event
import com.vitorpamplona.quartz.events.GiftWrapEvent
import com.vitorpamplona.quartz.events.SealedGossipEvent
import com.vitorpamplona.quartz.signers.NostrSignerInternal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.ConcurrentHashMap

class NotificationsService : Service() {
    private var channelRelaysId = "RelaysConnections"
    private var channelNotificationsId = "Notifications"

    private lateinit var notificationGroup: NotificationChannelGroupCompat

    private val roboIdentities = RoboIdentities()
    private val timer = Timer()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val processedEvents = ConcurrentHashMap<String, Boolean>()
    private var serviceStarted = false

    companion object {
        const val ACTION_STOP_SERVICE = "com.robosats.exp.action.STOP_NOTIFICATIONS"
        private const val NOTIFICATIONS_KEY = "settings_notifications"
    }

    private val clientNotificationListener =
        object : Client.Listener {
            override fun onEvent(
                event: Event,
                subscriptionId: String,
                relay: Relay,
                afterEOSE: Boolean,
            ) {
                if (event is GiftWrapEvent && processedEvents.putIfAbsent(event.id, true) == null) {
                    Log.d("RobosatsNotifications", "Relay Event: ${relay.url} - $subscriptionId - ${event.toJson()}")
                    val firstTaggedUser = event.firstTaggedUser()
                    val authors = garagePubKeys()

                    if (firstTaggedUser?.isNotEmpty() == true && authors.contains(firstTaggedUser)) {
                        Log.d("RobosatsNotifications", "Relay Event: ${relay.url} - $subscriptionId")

                        var nostrSigner = NostrSignerInternal(getRobotKeyPair(firstTaggedUser))
                        event.unwrap(nostrSigner) { gift ->
                            if (gift is SealedGossipEvent) {
                                gift.unseal(nostrSigner) { rumor ->
                                    if (rumor is ChatMessageEvent) {
                                        val lastNotification = EncryptedStorage.getEncryptedStorage("last_notification")
                                        if (lastNotification == "" || lastNotification.toLong() < rumor.createdAt) {
                                            val federationPubKeys = EncryptedStorage.getEncryptedStorage("federation_pubkeys")
                                            if (federationPubKeys.contains(rumor.pubKey)) {
                                                EncryptedStorage.setEncryptedStorage("last_notification", rumor.createdAt.toString())
                                                displayOrderNotification(rumor, firstTaggedUser)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

    private val networkCallback =
        object : ConnectivityManager.NetworkCallback() {
            var lastNetwork: Network? = null
            var receivedInitialCapabilities = false

            override fun onAvailable(network: Network) {
                super.onAvailable(network)

                if (lastNetwork != null && lastNetwork != network) {
                    restartAfterNetworkChange()
                }

                lastNetwork = network
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities,
            ) {
                super.onCapabilitiesChanged(network, networkCapabilities)

                val changed = Connectivity.updateNetworkCapabilities(networkCapabilities)
                val isInitialUpdate = !receivedInitialCapabilities
                receivedInitialCapabilities = true
                Log.d(
                    "RobosatsNotifications",
                    "onCapabilitiesChanged: ${network.networkHandle} hasMobileData ${Connectivity.isOnMobileData} hasWifi ${Connectivity.isOnWifiData}",
                )
                if (changed && !isInitialUpdate) {
                    scope.launch(Dispatchers.IO) {
                        restartAfterNetworkChange()
                    }
                }
            }
        }

    override fun onBind(intent: Intent): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        EncryptedStorage.init(applicationContext)

        try {
            NostrClient.init()

            val connectivityManager =
                (getSystemService(ConnectivityManager::class.java) as ConnectivityManager)
            connectivityManager.registerDefaultNetworkCallback(networkCallback)

        } catch (e: Throwable) {
            Log.e("NotificationsService", "Error in onCreate", e)
            stopSelf()
            throw e
        }
    }

    @RequiresPermission(Manifest.permission.POST_NOTIFICATIONS)
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP_SERVICE) {
            Log.d("RobosatsNotifications", "Received stop service action")
            EncryptedStorage.setEncryptedStorage(NOTIFICATIONS_KEY, "false")
            stopSelf()
            return START_NOT_STICKY
        }

        if (!notificationsAllowed()) {
            Log.i("RobosatsNotifications", "Notifications are disabled or permission is unavailable")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        return if (startService()) START_STICKY else START_NOT_STICKY
    }

    override fun onDestroy() {
        timer.cancel()
        stopSubscription()
        scope.cancel()

        try {
            val connectivityManager =
                (getSystemService(ConnectivityManager::class.java) as ConnectivityManager)
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (e: Exception) {
            Log.d("RobosatsNotifications", "Failed to unregisterNetworkCallback", e)
        }

        super.onDestroy()
    }

    @RequiresPermission(Manifest.permission.POST_NOTIFICATIONS)
    private fun startService(): Boolean {
        if (serviceStarted) return true
        return try {
            Log.d("RobosatsNotifications", "Starting foreground service...")
            startForeground(1, createNotification())
            serviceStarted = true
            keepAlive()

            startSubscription()
            true
        } catch (e: Exception) {
            Log.e("NotificationsService", "Error in service", e)
            stopSelf()
            false
        }
    }

    private fun startSubscription() {
        if (!Client.isSubscribed(clientNotificationListener)) Client.subscribe(clientNotificationListener)

        scope.launch {
            if (ArtiTorManager.start(applicationContext) is TorStatus.Active) NostrClient.start()
        }
    }

    private fun stopSubscription() {
        Client.unsubscribe(clientNotificationListener)
        NostrClient.stop()
    }

    private fun restartAfterNetworkChange() {
        scope.launch(Dispatchers.IO) {
            stopSubscription()
            if (ArtiTorManager.resetAfterNetworkChange(applicationContext) is TorStatus.Active) {
                delay(500)
                startSubscription()
            }
        }
    }

    private fun keepAlive() {
        timer.schedule(
            object : TimerTask() {
                override fun run() {
                    if (notificationsAllowed()) {
                        NostrClient.checkRelaysHealth()
                    } else {
                        Log.i("RobosatsNotifications", "Stopping after notifications were disabled")
                        stopSelf()
                    }
                }
            },
            5000,
            61000,
        )
    }

    @RequiresPermission(Manifest.permission.POST_NOTIFICATIONS)
    private fun createNotification(): Notification {
        val notificationManager = NotificationManagerCompat.from(this)

        Log.d("RobosatsNotifications", "Building groups...")
        notificationGroup = NotificationChannelGroupCompat.Builder("ServiceGroup")
            .setName(getString(R.string.notifications))
            .setDescription(getString(R.string.robosats_is_running_in_background))
            .build()

        notificationManager.createNotificationChannelGroup(notificationGroup)

        Log.d("RobosatsNotifications", "Building channels...")
        val channelRelays = NotificationChannelCompat.Builder(channelRelaysId, NotificationManager.IMPORTANCE_DEFAULT)
            .setName(getString(R.string.service))
            .setGroup(notificationGroup.id)
            .build()

        val channelNotification = NotificationChannelCompat.Builder(channelNotificationsId, NotificationManager.IMPORTANCE_HIGH)
            .setName(getString(R.string.notifications))
            .setGroup(notificationGroup.id)
            .build()

        notificationManager.createNotificationChannel(channelRelays)
        notificationManager.createNotificationChannel(channelNotification)

        Log.d("RobosatsNotifications", "Building notification...")

        val stopIntent = Intent(this, NotificationsService::class.java).apply {
            action = ACTION_STOP_SERVICE
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            0,
            stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notificationBuilder =
            NotificationCompat.Builder(this, channelRelaysId)
                .setContentTitle(getString(R.string.robosats_is_running_in_background))
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setGroup(notificationGroup.id)
                .setSmallIcon(R.drawable.ic_notification)
                .setOngoing(true)
                .addAction(
                    R.drawable.ic_notification,
                    getString(R.string.stop),
                    stopPendingIntent
                )

        val build = notificationBuilder.build()
        notificationManager.notify(1, build)
        return build
    }

    private fun displayOrderNotification(event: ChatMessageEvent, hexPubKey: String) {
        val notificationManager =
            getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        val orderId = event.firstTag("order_id")

        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            putExtra("order_id", orderId)
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            event.id.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val hashId = NostrClient.hashIdForPubKey(hexPubKey)
        val bitmap = hashId?.takeIf(String::isNotEmpty)?.let(::robotAvatar)

        val builder: NotificationCompat.Builder =
            NotificationCompat.Builder(
                applicationContext,
                channelNotificationsId,
            )
                .setContentTitle(orderId?.replace("/", "#")?.replaceFirstChar { it.uppercase() })
                .setContentText(event.content)
                .setSmallIcon(R.drawable.ic_notification)
                .setLargeIcon(bitmap)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)

        notificationManager.notify(event.id.hashCode(), builder.build())
    }

    private fun notificationsAllowed(): Boolean {
        if (EncryptedStorage.getEncryptedStorage(NOTIFICATIONS_KEY) != "true") return false
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private fun robotAvatar(hashId: String): Bitmap? = runCatching {
        val encoded = roboIdentities.generateRobohash("$hashId;80")
        if (encoded.isEmpty()) {
            null
        } else {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let(::getRoundedBitmap)
        }
    }.onFailure {
        Log.w("RobosatsNotifications", "Could not build notification avatar", it)
    }.getOrNull()

    private fun getRoundedBitmap(bitmap: Bitmap): Bitmap {
        val output = createBitmap(bitmap.width, bitmap.height)
        val canvas = Canvas(output)
        val paint = Paint()
        val path = Path()

        path.addRoundRect(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat(),
            bitmap.width / 2f, bitmap.height / 2f, Path.Direction.CW)

        canvas.clipPath(path)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)

        return output
    }

}
