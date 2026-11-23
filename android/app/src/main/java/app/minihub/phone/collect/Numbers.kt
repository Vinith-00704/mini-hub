package app.minihub.phone.collect

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager

/**
 * Phone numbers as the record keeps them: one key per person, whatever way the number was written
 * ("+1 555 0100", "555-0100"), so the hub can put a call and an SMS from the same person together.
 */
object Numbers {
    /**
     * E.164 ("+15550100") with the phone's own country; failing that "+" and the digits when there are 5 or more;
     * an alphanumeric sender ("Example-Bank") lower-cased and trimmed. Null when there is nothing to key on.
     */
    fun key(raw: String, countryIso: String): String? {
        val t = raw.trim()
        if (t.isEmpty()) return null
        // A sender name with letters is not a number: libphonenumber would read its letters as keypad digits.
        if (t.any { it.isLetter() }) return t.lowercase()
        runCatching { PhoneNumberUtils.formatNumberToE164(t, countryIso) }.getOrNull()?.let { return it }
        val digits = t.filter { it in '0'..'9' }
        return if (digits.length >= 5) "+$digits" else null
    }

    /** The country the phone is in (the network's, else the SIM's), upper case; empty when Android does not know. */
    fun country(context: Context): String {
        val tm = context.getSystemService(TelephonyManager::class.java) ?: return ""
        val iso = runCatching { tm.networkCountryIso }.getOrNull().orEmpty().ifEmpty { runCatching { tm.simCountryIso }.getOrNull().orEmpty() }
        return iso.uppercase()
    }

    /** The contact's name for this number, on the phone only; null without the contacts permission or no match. */
    fun name(context: Context, number: String): String? {
        if (number.isBlank()) return null
        if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return try {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() } else null
            }
        } catch (e: SecurityException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
