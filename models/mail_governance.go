package models

import (
	"strings"
	"time"

	"github.com/jinzhu/gorm"
)

const (
	SettingMailEmergencyStop = "mail_emergency_stop"
	MaskedSecretValue        = "********"

	SuppressionReasonManual = "manual"
	SuppressionReasonBounce = "bounce"
)

// SuppressedRecipient prevents delivery to an address for authorized training
// governance reasons such as manual opt-out or bounce handling.
type SuppressedRecipient struct {
	Id        int64     `json:"id"`
	UserId    int64     `json:"-"`
	Email     string    `json:"email"`
	Reason    string    `json:"reason"`
	CreatedBy int64     `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

func AddSuppressedRecipient(s *SuppressedRecipient) error {
	s.Email = strings.ToLower(strings.TrimSpace(s.Email))
	if s.Reason == "" {
		s.Reason = SuppressionReasonManual
	}
	if s.CreatedAt.IsZero() {
		s.CreatedAt = time.Now().UTC()
	}
	return db.Save(s).Error
}

func IsRecipientSuppressed(uid int64, email string) (bool, error) {
	suppressed := SuppressedRecipient{}
	err := db.Where("user_id=? and email=?", uid, strings.ToLower(strings.TrimSpace(email))).First(&suppressed).Error
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func GetMailEmergencyStopEnabled() bool {
	setting, err := GetSystemSetting(SettingMailEmergencyStop)
	if err != nil {
		return false
	}
	value := strings.ToLower(strings.TrimSpace(setting.Value))
	return value == "true" || value == "1" || value == "enabled"
}

func FilterSendableMailLogs(ms []*MailLog) ([]*MailLog, error) {
	if GetMailEmergencyStopEnabled() {
		return []*MailLog{}, nil
	}
	filtered := []*MailLog{}
	for _, m := range ms {
		result, err := GetResult(m.RId)
		if err != nil {
			return filtered, err
		}
		suppressed, err := IsRecipientSuppressed(m.UserId, result.Email)
		if err != nil {
			return filtered, err
		}
		if suppressed {
			err = UpdateRecipientDeliveryStatusByRID(m.RId, DeliveryStatusSuppressed, "recipient suppressed by delivery governance")
			if err != nil {
				return filtered, err
			}
			continue
		}
		filtered = append(filtered, m)
	}
	return filtered, nil
}

func SanitizeSMTPForResponse(s SMTP) SMTP {
	if s.Password != "" {
		s.Password = MaskedSecretValue
	}
	return s
}

func SanitizeSMTPsForResponse(ss []SMTP) []SMTP {
	for i := range ss {
		ss[i] = SanitizeSMTPForResponse(ss[i])
	}
	return ss
}
