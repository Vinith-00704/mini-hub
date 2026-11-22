package app.minihub.phone.link

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

object Pin {
    /** The hex SHA-256 of a certificate's public key (SubjectPublicKeyInfo, DER), as the hub computes it. */
    fun spkiSha256(cert: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded).joinToString("") { "%02x".format(it) }
}

/** Trusts exactly one hub: the one whose public key has the pinned hash (docs/04 > Finding the hub). Nothing else. */
class PinnedTrust(private val fp: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("The hub sent no certificate.")
        if (!MessageDigest.isEqual(Pin.spkiSha256(leaf).toByteArray(), fp.toByteArray())) throw CertificateException("This is not your paired hub.")
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("The phone does not accept connections.")

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
}

/**
 * Only for pairing with an address typed by hand: there is no hash to pin yet, so the hash of whatever answers is
 * kept, the four words are worked out from it, and the owner's comparison of the words is the check.
 */
class FirstSightTrust : X509TrustManager {
    @Volatile var seen: String? = null
        private set

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("The hub sent no certificate.")
        seen = Pin.spkiSha256(leaf)
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("The phone does not accept connections.")

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
}
