package app.minihub.phone.link

import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import okhttp3.TlsVersion

/**
 * An HTTP client for the hub only: TLS 1.3, and trust decided by [trust] alone (the pinned hash). The hub's
 * certificate names no address, so the host-name check is replaced by the pin, which is stronger.
 */
object Tls {
    fun client(trust: X509TrustManager): OkHttpClient {
        val ctx = SSLContext.getInstance("TLSv1.3").apply { init(null, arrayOf(trust), SecureRandom()) }
        return OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, trust)
            .hostnameVerifier { _, _ -> true }
            .connectionSpecs(listOf(ConnectionSpec.Builder(ConnectionSpec.RESTRICTED_TLS).tlsVersions(TlsVersion.TLS_1_3).build()))
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }
}
