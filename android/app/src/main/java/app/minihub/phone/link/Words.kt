package app.minihub.phone.link

import java.security.MessageDigest

/**
 * The four words both screens show while pairing (docs/04 > Pairing a device). The same list, in the same order, as
 * protocol/src/words.ts, and the same derivation as protocol/src/link.ts > pairingWords.
 */
object Words {
    val LIST: List<String> = listOf(
        "acorn", "actor", "adult", "agent", "alarm", "album", "alley", "amber", "angle", "ankle", "apple", "apron",
        "arrow", "atlas", "attic", "award", "bacon", "badge", "bagel", "baker", "banjo", "barn", "basil", "beach",
        "beard", "bell", "bench", "berry", "bike", "bird", "blade", "blanket", "bloom", "board", "boat", "bone",
        "book", "boot", "bottle", "bowl", "brain", "bread", "brick", "bridge", "brush", "bucket", "button", "cabin",
        "cable", "cactus", "camel", "camera", "candle", "canoe", "carpet", "carrot", "castle", "cave", "chair", "chalk",
        "cheese", "cherry", "chess", "circle", "city", "cliff", "clock", "cloud", "clover", "coast", "coat", "coconut",
        "coffee", "coin", "comet", "cookie", "copper", "coral", "corner", "cotton", "cousin", "crane", "crayon", "cricket",
        "crown", "cup", "curtain", "daisy", "dancer", "desert", "diamond", "dinner", "doctor", "dolphin", "donkey", "door",
        "dragon", "drum", "duck", "eagle", "earth", "echo", "elbow", "engine", "falcon", "farmer", "feather", "fence",
        "field", "finger", "flag", "flame", "flute", "forest", "fossil", "fountain", "fox", "frog", "garden", "garlic",
        "giant", "ginger", "glass", "globe", "glove", "goat", "grape", "guitar", "hammer", "harbor", "hat", "hawk",
        "helmet", "honey", "horse", "house", "island", "ivory", "jacket", "jaguar", "jelly", "jewel", "jungle", "kettle",
        "kitten", "kite", "ladder", "lake", "lamp", "lemon", "letter", "lily", "lion", "lizard", "lobster", "magnet",
        "mango", "maple", "marble", "meadow", "melon", "mirror", "monkey", "moon", "mountain", "mouse", "muffin", "needle",
        "nest", "noodle", "ocean", "olive", "onion", "orange", "orbit", "otter", "owl", "paddle", "palace", "panda",
        "paper", "parrot", "peach", "peanut", "pebble", "pencil", "pepper", "piano", "pickle", "pigeon", "pillow", "pilot",
        "planet", "plum", "pocket", "pony", "potato", "pumpkin", "puzzle", "rabbit", "radio", "rainbow", "raven", "ribbon",
        "river", "robot", "rocket", "rose", "saddle", "salmon", "sandal", "saucer", "scarf", "seal", "shadow", "shell",
        "ship", "shovel", "silver", "snail", "socket", "spider", "spoon", "square", "squirrel", "star", "stone", "storm",
        "sugar", "summer", "sunset", "swan", "table", "tiger", "toast", "tomato", "tower", "tractor", "train", "tulip",
        "turtle", "umbrella", "valley", "violin", "wagon", "walnut", "whale", "window", "winter", "wizard", "wolf", "zebra",
        "yogurt", "zipper", "pirate", "lantern",
    )

    /** From the certificate as the phone sees it, the code, and both sides' random values (commit, then reveal). */
    fun pairing(fp: String, code: String, phoneNonce: String, hubNonce: String): List<String> {
        val d = MessageDigest.getInstance("SHA-256").digest("minihub-pair-v2|$fp|$code|$phoneNonce|$hubNonce".toByteArray(Charsets.UTF_8))
        return (0 until 4).map { LIST[d[it].toInt() and 0xff] }
    }

    /** The phone's commitment: the hash of its random value, sent before it has seen the hub's. */
    fun commit(phoneNonce: String): String =
        MessageDigest.getInstance("SHA-256").digest("minihub-commit|$phoneNonce".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
