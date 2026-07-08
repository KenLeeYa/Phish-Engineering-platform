package models

import (
	"strconv"
)

const (
	SettingReportPrivacyThreshold = "report_privacy_threshold"

	TrainingRiskLow      = "low"
	TrainingRiskMedium   = "medium"
	TrainingRiskHigh     = "high"
	TrainingRiskCritical = "critical"

	PrivacyThresholdMessageZHTW = "資料量不足，為保護隱私不顯示細部資料"
)

type TrainingRiskWeights struct {
	ClickedLink                int `json:"clicked_link"`
	SubmittedSimulatedForm     int `json:"submitted_simulated_form"`
	IncompleteAssignedTraining int `json:"incomplete_assigned_training"`
	RepeatedRiskyBehavior      int `json:"repeated_risky_behavior"`
	ReportedSuspiciousEmail    int `json:"reported_suspicious_email"`
	CompletedTraining          int `json:"completed_training"`
}

type EnterpriseReportSummary struct {
	CampaignId             int64  `json:"campaign_id"`
	TotalRecipients        int64  `json:"total_recipients"`
	SentCount              int64  `json:"sent_count"`
	DeliveredCount         int64  `json:"delivered_count"`
	OpenedCount            int64  `json:"opened_count"`
	ClickedCount           int64  `json:"clicked_count"`
	SubmittedFormCount     int64  `json:"submitted_simulated_form_count"`
	ReportedCount          int64  `json:"reported_suspicious_email_count"`
	BouncedCount           int64  `json:"bounced_count"`
	DeferredCount          int64  `json:"deferred_count"`
	FailedCount            int64  `json:"failed_count"`
	SuppressedCount        int64  `json:"suppressed_count"`
	TrainingAssignedCount  int64  `json:"training_assigned_count"`
	TrainingCompletedCount int64  `json:"training_completed_count"`
	RepeatRiskCount        int64  `json:"repeat_risk_count"`
	TrainingRiskIndicator  int    `json:"training_risk_indicator"`
	TrainingRiskLevel      string `json:"training_risk_level"`
	PrivacyProtected       bool   `json:"privacy_protected"`
	PrivacyMessage         string `json:"privacy_message,omitempty"`
}

func DefaultTrainingRiskWeights() TrainingRiskWeights {
	return TrainingRiskWeights{
		ClickedLink:                30,
		SubmittedSimulatedForm:     50,
		IncompleteAssignedTraining: 20,
		RepeatedRiskyBehavior:      20,
		ReportedSuspiciousEmail:    -30,
		CompletedTraining:          -20,
	}
}

func GetReportPrivacyThreshold() int64 {
	setting, err := GetSystemSetting(SettingReportPrivacyThreshold)
	if err != nil {
		return 5
	}
	threshold, err := strconv.ParseInt(setting.Value, 10, 64)
	if err != nil || threshold < 1 {
		return 5
	}
	return threshold
}

func TrainingRiskLevel(score int) string {
	switch {
	case score >= 80:
		return TrainingRiskCritical
	case score >= 50:
		return TrainingRiskHigh
	case score >= 25:
		return TrainingRiskMedium
	default:
		return TrainingRiskLow
	}
}

func CalculateTrainingRiskIndicator(summary EnterpriseReportSummary, weights TrainingRiskWeights) int {
	if summary.TotalRecipients == 0 {
		return 0
	}
	score := 0
	score += int(summary.ClickedCount) * weights.ClickedLink / int(summary.TotalRecipients)
	score += int(summary.SubmittedFormCount) * weights.SubmittedSimulatedForm / int(summary.TotalRecipients)
	score += int(summary.RepeatRiskCount) * weights.RepeatedRiskyBehavior / int(summary.TotalRecipients)
	score += int(summary.ReportedCount) * weights.ReportedSuspiciousEmail / int(summary.TotalRecipients)
	if summary.TrainingAssignedCount > 0 {
		incomplete := summary.TrainingAssignedCount - summary.TrainingCompletedCount
		score += int(incomplete) * weights.IncompleteAssignedTraining / int(summary.TrainingAssignedCount)
		score += int(summary.TrainingCompletedCount) * weights.CompletedTraining / int(summary.TrainingAssignedCount)
	}
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func countCampaignEvents(cid int64, message string) (int64, error) {
	var count int64
	err := db.Model(&Event{}).Where("campaign_id=? and message=?", cid, message).Count(&count).Error
	return count, err
}

func countDeliveryStatus(cid int64, status string) (int64, error) {
	var count int64
	err := db.Model(&RecipientDeliveryStatus{}).Where("campaign_id=? and status=?", cid, status).Count(&count).Error
	return count, err
}

func GetEnterpriseReportSummary(cid int64, uid int64, weights TrainingRiskWeights) (EnterpriseReportSummary, error) {
	summary := EnterpriseReportSummary{CampaignId: cid}
	err := db.Model(&Result{}).Where("campaign_id=? and user_id=?", cid, uid).Count(&summary.TotalRecipients).Error
	if err != nil {
		return summary, err
	}
	if summary.TotalRecipients < GetReportPrivacyThreshold() {
		summary.PrivacyProtected = true
		summary.PrivacyMessage = PrivacyThresholdMessageZHTW
	}
	if summary.SentCount, err = countCampaignEvents(cid, EventSent); err != nil {
		return summary, err
	}
	if summary.OpenedCount, err = countCampaignEvents(cid, EventOpened); err != nil {
		return summary, err
	}
	if summary.ClickedCount, err = countCampaignEvents(cid, EventClicked); err != nil {
		return summary, err
	}
	if summary.SubmittedFormCount, err = countCampaignEvents(cid, EventDataSubmit); err != nil {
		return summary, err
	}
	if summary.ReportedCount, err = countCampaignEvents(cid, EventReported); err != nil {
		return summary, err
	}
	if summary.DeliveredCount, err = countDeliveryStatus(cid, DeliveryStatusSent); err != nil {
		return summary, err
	}
	if summary.BouncedCount, err = countDeliveryStatus(cid, DeliveryStatusBounced); err != nil {
		return summary, err
	}
	if summary.DeferredCount, err = countDeliveryStatus(cid, DeliveryStatusDeferred); err != nil {
		return summary, err
	}
	if summary.FailedCount, err = countDeliveryStatus(cid, DeliveryStatusFailed); err != nil {
		return summary, err
	}
	if summary.SuppressedCount, err = countDeliveryStatus(cid, DeliveryStatusSuppressed); err != nil {
		return summary, err
	}
	err = db.Model(&TrainingAssignment{}).Where("campaign_id=?", cid).Count(&summary.TrainingAssignedCount).Error
	if err != nil {
		return summary, err
	}
	err = db.Table("training_completions").
		Joins("JOIN training_assignments ON training_assignments.id = training_completions.assignment_id").
		Where("training_assignments.campaign_id=?", cid).
		Count(&summary.TrainingCompletedCount).Error
	if err != nil {
		return summary, err
	}
	summary.RepeatRiskCount = summary.SubmittedFormCount
	summary.TrainingRiskIndicator = CalculateTrainingRiskIndicator(summary, weights)
	summary.TrainingRiskLevel = TrainingRiskLevel(summary.TrainingRiskIndicator)
	return summary, nil
}
