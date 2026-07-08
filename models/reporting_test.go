package models

import check "gopkg.in/check.v1"

func (s *ModelsSuite) TestTrainingRiskIndicator(c *check.C) {
	summary := EnterpriseReportSummary{
		TotalRecipients:        10,
		ClickedCount:           2,
		SubmittedFormCount:     1,
		ReportedCount:          1,
		TrainingAssignedCount:  2,
		TrainingCompletedCount: 1,
	}
	score := CalculateTrainingRiskIndicator(summary, DefaultTrainingRiskWeights())
	c.Assert(score, check.Equals, 8)
	c.Assert(TrainingRiskLevel(score), check.Equals, TrainingRiskLow)

	custom := DefaultTrainingRiskWeights()
	custom.ClickedLink = 60
	score = CalculateTrainingRiskIndicator(summary, custom)
	c.Assert(score, check.Equals, 14)
	c.Assert(TrainingRiskLevel(55), check.Equals, TrainingRiskHigh)
}

func (s *ModelsSuite) TestEnterpriseReportSummaryAggregates(c *check.C) {
	campaign := s.createCampaign(c)
	c.Assert(PutSystemSetting(SettingReportPrivacyThreshold, "3"), check.Equals, nil)

	result := campaign.Results[0]
	c.Assert(result.HandleEmailSent(), check.Equals, nil)
	c.Assert(result.HandleClickedLink(EventDetails{}), check.Equals, nil)

	submitted := campaign.Results[1]
	c.Assert(submitted.HandleFormSubmit(EventDetails{}), check.Equals, nil)

	reported := campaign.Results[2]
	c.Assert(reported.HandleEmailReport(EventDetails{}), check.Equals, nil)

	module := TrainingModule{
		Title:            "補救訓練",
		Locale:           TrainingLocaleZHTW,
		Category:         TrainingCategorySafeForm,
		Difficulty:       "beginner",
		EstimatedMinutes: 5,
		ContentType:      TrainingContentMarkdown,
		Status:           TrainingStatusPublished,
		OwnerId:          1,
	}
	c.Assert(PostTrainingModule(&module), check.Equals, nil)
	assignment, err := AssignTrainingForResult(submitted, module, int64(1), TrainingCategorySafeForm)
	c.Assert(err, check.Equals, nil)
	_, err = CompleteTrainingAssignment(assignment, 90, 80, 1, "web")
	c.Assert(err, check.Equals, nil)

	summary, err := GetEnterpriseReportSummary(campaign.Id, campaign.UserId, DefaultTrainingRiskWeights())
	c.Assert(err, check.Equals, nil)
	c.Assert(summary.TotalRecipients, check.Equals, int64(4))
	c.Assert(summary.SentCount, check.Equals, int64(1))
	c.Assert(summary.DeliveredCount, check.Equals, int64(1))
	c.Assert(summary.ClickedCount, check.Equals, int64(1))
	c.Assert(summary.SubmittedFormCount, check.Equals, int64(1))
	c.Assert(summary.ReportedCount, check.Equals, int64(1))
	c.Assert(summary.TrainingAssignedCount, check.Equals, int64(1))
	c.Assert(summary.TrainingCompletedCount, check.Equals, int64(1))
	c.Assert(summary.PrivacyProtected, check.Equals, false)
}

func (s *ModelsSuite) TestEnterpriseReportPrivacyThreshold(c *check.C) {
	campaign := s.createCampaign(c)
	c.Assert(PutSystemSetting(SettingReportPrivacyThreshold, "10"), check.Equals, nil)
	summary, err := GetEnterpriseReportSummary(campaign.Id, campaign.UserId, DefaultTrainingRiskWeights())
	c.Assert(err, check.Equals, nil)
	c.Assert(summary.PrivacyProtected, check.Equals, true)
	c.Assert(summary.PrivacyMessage, check.Equals, PrivacyThresholdMessageZHTW)
}
