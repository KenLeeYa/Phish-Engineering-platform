package models

import (
	"net/url"
	"strings"
)

const (
	SettingLandingPageSubmissionMode = "landing_page_submission_mode"

	LandingPageSubmissionMetricsOnly     = "metrics_only"
	LandingPageSubmissionRedactSensitive = "redact_sensitive_fields"
	LandingPageSubmissionDisabled        = "disabled"

	RedactedValue = "[redacted]"
)

// SystemSetting stores small platform-wide settings that are needed before a
// full enterprise configuration UI exists.
type SystemSetting struct {
	ID    int64  `json:"id"`
	Key   string `json:"key" sql:"not null;unique"`
	Value string `json:"value"`
}

// GetSystemSetting returns a system setting by key.
func GetSystemSetting(key string) (SystemSetting, error) {
	setting := SystemSetting{}
	err := db.Where("key=?", key).First(&setting).Error
	return setting, err
}

// PutSystemSetting creates or updates a system setting.
func PutSystemSetting(key string, value string) error {
	setting, err := GetSystemSetting(key)
	if err != nil {
		setting = SystemSetting{Key: key}
	}
	setting.Value = value
	return db.Save(&setting).Error
}

// GetLandingPageSubmissionMode returns the configured landing-page submission
// mode. Missing or unknown values fall back to metrics_only.
func GetLandingPageSubmissionMode() string {
	setting, err := GetSystemSetting(SettingLandingPageSubmissionMode)
	if err != nil {
		return LandingPageSubmissionMetricsOnly
	}
	switch setting.Value {
	case LandingPageSubmissionMetricsOnly, LandingPageSubmissionRedactSensitive, LandingPageSubmissionDisabled:
		return setting.Value
	default:
		return LandingPageSubmissionMetricsOnly
	}
}

// SanitizeLandingPagePayload returns a safe payload for event persistence.
func SanitizeLandingPagePayload(payload url.Values, mode string) url.Values {
	safe := url.Values{}
	switch mode {
	case LandingPageSubmissionRedactSensitive:
		for key, values := range payload {
			if key == RecipientParameter {
				continue
			}
			if IsSensitiveFieldName(key) {
				safe.Set(key, RedactedValue)
				continue
			}
			for _, value := range values {
				safe.Add(key, value)
			}
		}
		safe.Set("submission_mode", LandingPageSubmissionRedactSensitive)
	case LandingPageSubmissionDisabled:
		safe.Set("submission_mode", LandingPageSubmissionDisabled)
		safe.Set("submitted", "true")
	default:
		safe.Set("submission_mode", LandingPageSubmissionMetricsOnly)
		safe.Set("submitted", "true")
	}
	return safe
}

// IsSensitiveFieldName detects credential-like and secret-like form fields.
func IsSensitiveFieldName(name string) bool {
	normalized := strings.ToLower(strings.TrimSpace(name))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	if normalized == "" {
		return false
	}
	sensitiveExact := map[string]bool{
		"password":      true,
		"pass":          true,
		"passwd":        true,
		"pwd":           true,
		"token":         true,
		"otp":           true,
		"mfa":           true,
		"2fa":           true,
		"secret":        true,
		"api_key":       true,
		"session":       true,
		"cookie":        true,
		"authorization": true,
		"credential":    true,
		"credit_card":   true,
		"card_number":   true,
		"cvv":           true,
		"national_id":   true,
	}
	if sensitiveExact[normalized] {
		return true
	}
	sensitiveContains := []string{
		"password", "passwd", "credential", "secret", "session", "cookie",
		"authorization", "credit_card", "card_number", "national_id",
		"密碼", "驗證碼", "一次性密碼", "身分證", "信用卡", "安全碼",
	}
	for _, needle := range sensitiveContains {
		if strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}
