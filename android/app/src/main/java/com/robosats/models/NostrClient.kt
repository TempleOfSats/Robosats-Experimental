package com.robosats.models

import android.util.Log
import com.vitorpamplona.ammolite.relays.COMMON_FEED_TYPES
import com.vitorpamplona.ammolite.relays.Client
import com.vitorpamplona.ammolite.relays.Relay
import com.vitorpamplona.ammolite.relays.RelayPool
import com.vitorpamplona.ammolite.relays.TypedFilter
import com.vitorpamplona.ammolite.relays.filters.SincePerRelayFilter
import com.vitorpamplona.quartz.crypto.KeyPair
import com.vitorpamplona.quartz.encoders.Hex
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object NostrClient {
    private const val subscriptionId = "robosatsNotificationId"
    private const val maxNotificationRelays = 3
    private var authors = emptyList<String>()
    private var initialized = false
    private var configuredRelayUrls = emptySet<String>()

    fun init() {
        if (initialized) return
        runCatching {
            RelayPool.register(Client)
            initialized = true
        }.onFailure { Log.e("RoboSatsNostr", "Could not initialize Nostr", it) }
    }

    fun stop() {
        RelayPool.unloadRelays()
        configuredRelayUrls = emptySet()
    }

    fun start() {
        connectRelays()
        subscribeToInbox()
    }

    fun refresh() {
        val current = garagePubKeys()
        val relayUrls = relayUrls()
        val relayChanged = relayUrls != configuredRelayUrls
        if (relayChanged) {
            RelayPool.unloadRelays()
            configuredRelayUrls = emptySet()
            connectRelays(relayUrls)
        }
        if (relayChanged || authors.toSet() != current.toSet()) subscribeToInbox()
    }

    fun checkRelaysHealth() {
        if (RelayPool.getAll().isEmpty()) start()
        RelayPool.getAll().filterNot { it.isConnected() }.forEach { it.connectAndSendFiltersIfDisconnected() }
    }

    fun garagePubKeys(): List<String> = storedIdentities().map { it.publicKey }.distinct()

    fun getRobotKeyPair(hexPubKey: String): KeyPair {
        val identity = storedIdentities().firstOrNull { it.publicKey == hexPubKey }
            ?: throw IllegalArgumentException("Robot identity is not in encrypted garage storage")
        return KeyPair(Hex.decode(identity.privateKey), Hex.decode(identity.publicKey))
    }

    fun hashIdForPubKey(hexPubKey: String): String? =
        storedIdentities().firstOrNull { it.publicKey == hexPubKey }?.hashId

    private fun connectRelays(relayUrls: Set<String> = relayUrls()) {
        if (relayUrls.isEmpty()) return

        val selectedRelays = relayUrls.shuffled().take(maxNotificationRelays).toSet()
        Client.sendFilterOnlyIfDisconnected()
        selectedRelays.forEach { relayUrl ->
            if (RelayPool.getRelays(relayUrl).isEmpty()) {
                RelayPool.addRelay(
                    Relay(
                        relayUrl,
                        read = true,
                        write = false,
                        forceProxy = true,
                        activeTypes = COMMON_FEED_TYPES
                    )
                )
            }
        }
        configuredRelayUrls = relayUrls
    }

    private fun relayUrls(): Set<String> {
        val encoded = EncryptedStorage.getEncryptedStorage("federation_relays")
        if (encoded.isEmpty()) return emptySet()
        val relays = runCatching { JSONArray(encoded) }.getOrNull() ?: return emptySet()
        return (0 until relays.length()).map { relays.optString(it) }
            .filter { it.startsWith("ws://") || it.startsWith("wss://") }
            .toSet()
    }

    private fun subscribeToInbox() {
        authors = garagePubKeys()
        if (authors.isEmpty()) return
        Client.sendFilter(
            subscriptionId,
            listOf(
                TypedFilter(
                    types = COMMON_FEED_TYPES,
                    filter = SincePerRelayFilter(kinds = listOf(1059), tags = mapOf("p" to authors))
                )
            )
        )
    }

    private fun storedIdentities(): List<StoredIdentity> {
        val encoded = EncryptedStorage.getEncryptedStorage("garage_slots")
        if (encoded.isEmpty()) return emptyList()
        val garage = runCatching { JSONObject(encoded) }.getOrNull() ?: return emptyList()
        val identities = mutableListOf<StoredIdentity>()

        garage.keys().forEach { slotKey ->
            val slot = garage.optJSONObject(slotKey) ?: return@forEach
            val token = slot.optString("token")
            val hashId = slot.optString("hashId")
            val topPublicKey = slot.optString("nostrPubKey")
            val topPrivateKey = parseSecret(slot.optJSONObject("nostrSecKey")) ?: deriveSecret(token)

            if (topPublicKey.isNotEmpty() && topPrivateKey.isNotEmpty()) {
                identities += StoredIdentity(topPublicKey, topPrivateKey, hashId)
                return@forEach
            }

            val robots = slot.optJSONObject("robots") ?: return@forEach
            robots.keys().forEach { robotKey ->
                val robot = robots.optJSONObject(robotKey) ?: return@forEach
                val publicKey = robot.optString("nostrPubKey")
                if (publicKey.isNotEmpty() && topPrivateKey.isNotEmpty()) {
                    identities += StoredIdentity(publicKey, topPrivateKey, hashId)
                }
            }
        }
        return identities.distinctBy { it.publicKey }
    }

    private fun parseSecret(value: JSONObject?): String? {
        if (value == null) return null
        val bytes = (0 until 32).mapNotNull { index ->
            if (value.has(index.toString())) value.optInt(index.toString()).toByte() else null
        }
        return if (bytes.size == 32) bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) } else null
    }

    private fun deriveSecret(token: String): String {
        if (token.isEmpty()) return ""
        val sha512 = MessageDigest.getInstance("SHA-512").digest(token.toByteArray(StandardCharsets.UTF_8))
        return MessageDigest.getInstance("SHA-256").digest(sha512)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private data class StoredIdentity(
        val publicKey: String,
        val privateKey: String,
        val hashId: String
    )
}
