package i18n

import (
	"encoding/json"
	"html/template"
	"log"
	"os"
	"path/filepath"
)

const (
	DefaultLocale  = "zh-TW"
	FallbackLocale = "en-US"
)

var messages = loadMessages()

func loadMessages() map[string]map[string]string {
	locales := map[string]map[string]string{}
	for _, locale := range []string{FallbackLocale, DefaultLocale} {
		path := "locales/" + locale + ".json"
		data, err := readLocaleFile(path)
		if err != nil {
			log.Fatalf("i18n: read %s: %v", path, err)
		}
		entries := map[string]string{}
		if err := json.Unmarshal(data, &entries); err != nil {
			log.Fatalf("i18n: parse %s: %v", path, err)
		}
		locales[locale] = entries
	}
	return locales
}

func readLocaleFile(path string) ([]byte, error) {
	for _, base := range []string{"i18n", filepath.Join("..", "i18n"), ".", ".."} {
		data, err := os.ReadFile(filepath.Join(base, path))
		if err == nil {
			return data, nil
		}
	}
	return os.ReadFile(path)
}

func Translate(locale, key string) string {
	if value, ok := messages[locale][key]; ok {
		return value
	}
	if value, ok := messages[FallbackLocale][key]; ok {
		return value
	}
	return key
}

func T(key string) string {
	return Translate(DefaultLocale, key)
}

func MustJSON(locale string) template.JS {
	entries, ok := messages[locale]
	if !ok {
		entries = messages[FallbackLocale]
	}
	data, err := json.Marshal(entries)
	if err != nil {
		log.Fatalf("i18n: marshal %s: %v", locale, err)
	}
	return template.JS(data)
}

func Messages(locale string) map[string]string {
	source, ok := messages[locale]
	if !ok {
		source = messages[FallbackLocale]
	}
	result := map[string]string{}
	for key, value := range source {
		result[key] = value
	}
	return result
}
