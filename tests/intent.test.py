# -*- coding: utf-8 -*-
"""Deterministic mirror of js/ai-engine.js intent dispatch regexes."""
import re

SPORTS = {
    "cricket": ["cricket", "क्रिकेट", "bat", "gully"],
    "football": ["football", "soccer", "फुटबॉल"],
    "badminton": ["badminton", "बैडमिंटन", "shuttle"],
    "running": ["run", "running", "jog", "jogging", "दौड़", "daud", "doud"],
    "cycling": ["cycl", "bike", "bicycle", "साइकिल", "cycle"],
    "walking": ["walk", "walking", "टहल", "stroll"],
    "tennis": ["tennis", "टेनिस"],
    "basketball": ["basketball", "बास्केटबॉल"],
    "yoga": ["yoga", "योग"],
    "swimming": ["swim", "तैर", "pool"],
    "hiking": ["trek", "hike", "hiking", "ट्रेक"],
    "picnic": ["picnic", "outing", "घूमने", "ghoom"],
    "gym": ["gym", "workout", "जिम"],
}

def detect_activity(q):
    for k, arr in SPORTS.items():
        if any(w in q for w in arr):
            return k
    return None

GREET = r'^\s*(hi|hey|hello|yo|namaste|namaskar)\b'
HELP = r'\b(help|madad|मदद)\b'
THANKS = r'thank|thanks|shukriya|dhanyavad|धन्यवाद|शुक्रिया'
RAIN = r'rain|barish|baarish|umbrella|chhata|chhatta|commute|travel|trip|बारिश|छाता|यात्रा'
FOOD = r'\b(eat|food|khana|khaana|meal|lunch|dinner|breakfast|nashta|snack)\b|खाना|खाने|नाश्ता|भोजन'
HYDR = r'water|paani|pani|hydrat|drink|पानी|प्यास'
HEAT = r'\b(heat|hot)\b|garmi|गर्मी|heatstroke|garmi se|protect.*sun|लू'
UV = r'\buv\b|sunscreen|sun|sunlight|धूप|यूवी|dhoop'
WIND = r'wind|hawa|hawaa|हवा|आंधी|storm|thunder|बिजली'
AQI = r'aqi|air quality|pollution|pm2|smog|pradushan|हवा की गुणवत्ता|प्रदूषण'
COMF = r'comfort|score|आराम|कम्फ'
CARRY = r'\b(carry|wear|clothes|dress|jacket|umbrella|sunscreen|kapde|kapda|chhata)\b|कपड़े|छाता|पहन|साथ'
PLAN = r'\b(plan|plans|planned|planning|brief|briefing|schedule|routine|itinerary|roster)\b|योजना|प्लान|ब्रीफ़िंग|ब्रीफिंग|दिनचर्या|डेली|दिन-भर|दिन भर|दिन का'
WINDOW = r'best time|when should|when can|when.*go|kab|समय|कब|सबसे अच्छा'

def intent(q):
    q = q.lower()
    if re.search(GREET, q, re.I): return "greeting"
    if re.search(HELP, q, re.I): return "help"
    if re.search(THANKS, q, re.I): return "thanks"
    if detect_activity(q): return "activity"
    if re.search(RAIN, q, re.I): return "rain"
    if re.search(FOOD, q, re.I): return "food"
    if re.search(HYDR, q, re.I): return "hydration"
    if re.search(HEAT, q, re.I): return "heat"
    if re.search(UV, q, re.I): return "uv"
    if re.search(WIND, q, re.I): return "wind"
    if re.search(AQI, q, re.I): return "aqi"
    if re.search(COMF, q, re.I): return "comfort"
    if re.search(CARRY, q, re.I): return "carry"
    if re.search(PLAN, q, re.I): return "plan"
    if re.search(WINDOW, q, re.I): return "window"
    return "summary"

tests = [
    ("What should I carry today?", "carry"),
    ("आज मुझे क्या साथ ले जाना चाहिए?", "carry"),
    ("क्या मैं आज शाम क्रिकेट खेल सकता हूँ?", "activity"),
    ("Can I play cricket this evening?", "activity"),
    ("Give me today's daily briefing", "plan"),
    ("आज का डेली ब्रीफ़िंग दें", "plan"),
    ("plan my day", "plan"),
    ("when is the best time to go out", "window"),
    ("when should I walk", "activity"),
    ("कब जाऊँ घूमने", "activity"),
    ("should I carry an umbrella", "rain"),     # umbrella answer lives in rain intent (by design)
    ("what should I wear", "carry"),
    ("is it hot", "heat"),
    ("weather today", "summary"),
    ("how's the weather", "summary"),
    ("is it hot outside", "heat"),
    ("how is the air quality", "aqi"),
    ("Thanks", "thanks"),
    ("hey", "greeting"),
]
ok = True
for q, want in tests:
    got = intent(q)
    mark = "OK  " if got == want else "FAIL"
    if got != want:
        ok = False
    print("%s want=%-9s q=%-45s got=%s" % (mark, want, q, got))
print("ALL PASS" if ok else "SOME FAILED")