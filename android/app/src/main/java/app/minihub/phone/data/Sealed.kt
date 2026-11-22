package app.minihub.phone.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small secrets kept in a file, sealed with an AES key that lives in the Android Keystore and never leaves it
 * (docs/03 > Keys and secrets). Used for the record's database key and for the hub's token.
 */
class Sealed(private val alias: String, private val file: File) {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun read(): ByteArray? {
        if (!file.exists()) return null
        val all = file.readBytes()
        if (all.size < 13) return null
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
        return c.doFinal(all, 12, all.size - 12)
    }

    fun write(secret: ByteArray) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(secret)
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(out)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    fun delete() {
        file.delete()
    }

    companion object {
        /** The record's database key: 32 random bytes, made once. */
        fun databaseKey(dir: File): ByteArray {
            val s = Sealed("mini-record", File(dir, "record.key"))
            s.read()?.let { return it }
            val k = ByteArray(32).also { SecureRandom().nextBytes(it) }
            s.write(k)
            return k
        }
    }
}
