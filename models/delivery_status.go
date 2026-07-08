package models

import (
	"time"

	"github.com/jinzhu/gorm"
)

const (
	DeliveryStatusQueued     = "queued"
	DeliveryStatusScheduled  = "scheduled"
	DeliveryStatusSending    = "sending"
	DeliveryStatusSent       = "sent"
	DeliveryStatusDeferred   = "deferred"
	DeliveryStatusBounced    = "bounced"
	DeliveryStatusFailed     = "failed"
	DeliveryStatusCancelled  = "cancelled"
	DeliveryStatusSuppressed = "suppressed"
)

// RecipientDeliveryStatus records governed per-recipient delivery state without
// changing the mail transport behavior.
type RecipientDeliveryStatus struct {
	Id                  int64     `json:"id"`
	CampaignId          int64     `json:"campaign_id"`
	RecipientId         int64     `json:"recipient_id"`
	RId                 string    `json:"recipient_result_id"`
	UserId              int64     `json:"-"`
	Email               string    `json:"email"`
	SendingProfileId    int64     `json:"sending_profile_id"`
	ScheduledAt         time.Time `json:"scheduled_at"`
	AttemptedAt         time.Time `json:"attempted_at"`
	SentAt              time.Time `json:"sent_at"`
	Status              string    `json:"status"`
	ProviderMessageId   string    `json:"provider_message_id,omitempty"`
	SMTPResponseSummary string    `json:"smtp_response_summary,omitempty"`
	RetryCount          int       `json:"retry_count"`
	LastErrorSummary    string    `json:"last_error_summary,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

func GetDeliveryStatusesByCampaign(cid int64, uid int64) ([]RecipientDeliveryStatus, error) {
	statuses := []RecipientDeliveryStatus{}
	err := db.Where("campaign_id=? and user_id=?", cid, uid).Order("scheduled_at asc, id asc").Find(&statuses).Error
	return statuses, err
}

func UpdateRecipientDeliveryStatusByRID(rid string, status string, errSummary string) error {
	ds := RecipientDeliveryStatus{}
	err := db.Where("r_id=?", rid).First(&ds).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	ds.Status = status
	ds.AttemptedAt = now
	ds.UpdatedAt = now
	ds.LastErrorSummary = errSummary
	if status == DeliveryStatusSent {
		ds.SentAt = now
		ds.SMTPResponseSummary = ""
		ds.LastErrorSummary = ""
	}
	if status == DeliveryStatusDeferred || status == DeliveryStatusFailed || status == DeliveryStatusBounced {
		ds.RetryCount++
	}
	return db.Save(&ds).Error
}
