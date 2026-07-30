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
    private const val currentGarageKey = "robosats_exp_garage_slots_v1"
    private const val subscriptionId = "robosatsNotificationId"
    private const val maxNotificationRelays = 3
    private const val relayOrderKey = "robosats_notification_relay_order_v1"
    private var authors = emptyList<String>()
    private var initialized = false
    private var configuredRelayUrls = emptySet<String>()
    private val relayFailures = mutableMapOf<String, Int>()

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
        relayFailures.clear()
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
        if (relayChanged || authors.toSet() != current.toSet()) subscribeToInbox(current)
    }

    fun refreshGarage(encoded: String) {
        val current = parseCurrentGarage(encoded).map { it.publicKey }.distinct()
        if (authors.toSet() != current.toSet()) subscribeToInbox(current)
    }

    fun checkRelaysHealth() {
        if (RelayPool.getAll().isEmpty()) start()
        val relays = RelayPool.getAll()
        relays.forEach { relay ->
            relayFailures[relay.url] = if (relay.isConnected()) 0 else (relayFailures[relay.url] ?: 0) + 1
        }
        val previousOrder = storedRelayOrder()
        val connected = relays.filter { it.isConnected() }.map { it.url }
        val nextOrder = (connected
            + previousOrder.filter { relayFailures.getOrDefault(it, 0) < 3 }
            + configuredRelayUrls.sorted())
            .distinct()
            .take(maxNotificationRelays)
        if (nextOrder != previousOrder.take(maxNotificationRelays)) {
            persistRelayOrder(nextOrder)
            RelayPool.unloadRelays()
            configuredRelayUrls = emptySet()
            connectRelays()
            subscribeToInbox()
            return
        }
        relays.filterNot { it.isConnected() }.forEach { it.connectAndSendFiltersIfDisconnected() }
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

        val previousOrder = storedRelayOrder()
        val selectedRelays = (previousOrder.filter(relayUrls::contains) + relayUrls.sorted())
            .distinct()
            .take(maxNotificationRelays)
            .toSet()
        persistRelayOrder(selectedRelays.toList())
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

    private fun storedRelayOrder(): List<String> = runCatching {
        val values = JSONArray(EncryptedStorage.getEncryptedStorage(relayOrderKey))
        (0 until values.length()).map { values.optString(it) }
    }.getOrDefault(emptyList())

    private fun persistRelayOrder(relays: List<String>) {
        EncryptedStorage.setEncryptedStorage(relayOrderKey, JSONArray(relays).toString())
    }

    private fun relayUrls(): Set<String> {
        val encoded = EncryptedStorage.getEncryptedStorage("federation_relays")
        if (encoded.isEmpty()) return emptySet()
        val relays = runCatching { JSONArray(encoded) }.getOrNull() ?: return emptySet()
        return (0 until relays.length()).map { relays.optString(it) }
            .filter { it.startsWith("ws://") || it.startsWith("wss://") }
            .toSet()
    }

    private fun subscribeToInbox(currentAuthors: List<String> = garagePubKeys()) {
        authors = currentAuthors
        if (authors.isEmpty()) {
            Client.close(subscriptionId)
            return
        }
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
        val current = EncryptedStorage.getEncryptedStorage(currentGarageKey)
        return parseCurrentGarage(current).distinctBy { it.publicKey }
    }

    private fun parseCurrentGarage(encoded: String): List<StoredIdentity> {
        if (encoded.isEmpty()) return emptyList()
        val garage = runCatching {
            val payload = JSONObject(encoded)
            if (payload.optString("format") != "robosats-exp-garage-slots" || payload.optInt("version") != 1) {
                null
            } else {
                payload.optJSONArray("slots")
            }
        }.getOrNull()
            ?: return emptyList()
        return (0 until garage.length()).flatMap { index ->
            identitiesFromSlot(garage.optJSONObject(index))
        }
    }

    private fun identitiesFromSlot(slot: JSONObject?): List<StoredIdentity> {
        if (slot == null) return emptyList()
        val token = slot.optString("token")
        if (token.isEmpty()) return emptyList()
        val hashId = slot.optString("hashId").ifEmpty { deriveHashId(token) }
        val privateKey = parseSecret(slot.optJSONObject("nostrSecKey")) ?: deriveSecret(token)
        if (privateKey.isEmpty()) return emptyList()

        val publicKeys = linkedSetOf<String>()
        slot.optString("nostrPubKey").takeIf(String::isNotEmpty)?.let(publicKeys::add)
        val robots = slot.optJSONObject("robots")
        robots?.keys()?.forEach { robotKey ->
            robots.optJSONObject(robotKey)?.optString("nostrPubKey")
                ?.takeIf(String::isNotEmpty)
                ?.let(publicKeys::add)
        }
        return publicKeys.map { StoredIdentity(it, privateKey, hashId) }
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

    private fun deriveHashId(token: String): String {
        val first = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return MessageDigest.getInstance("SHA-256").digest(first.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private data class StoredIdentity(
        val publicKey: String,
        val privateKey: String,
        val hashId: String
    )
}
