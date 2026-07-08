package i18n

import "testing"

func TestDefaultLocaleFallsBackToEnglish(t *testing.T) {
	if got := Translate("missing-locale", "nav.dashboard"); got != "Dashboard" {
		t.Fatalf("expected English fallback, got %q", got)
	}
	if got := T("nav.dashboard"); got != "儀表板" {
		t.Fatalf("expected zh-TW default, got %q", got)
	}
	if got := T("missing.key"); got != "missing.key" {
		t.Fatalf("expected missing key to be returned, got %q", got)
	}
}

func TestDefaultLocaleHasFallbackKeys(t *testing.T) {
	zhTW := Messages(DefaultLocale)
	enUS := Messages(FallbackLocale)
	for key := range enUS {
		if _, ok := zhTW[key]; !ok {
			t.Fatalf("zh-TW is missing translation key %q", key)
		}
	}
}
