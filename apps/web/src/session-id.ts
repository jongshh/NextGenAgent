// HTML's pattern attribute is compiled with the Unicode Sets (`v`) flag in
// current browsers. Keep the hyphen outside the character class so it cannot
// be interpreted as an invalid set operator.
export const PARTICIPANT_ID_PATTERN = "(?:[A-Za-z0-9가-힣_]|-){4,32}";
