package models

import check "gopkg.in/check.v1"

func (s *ModelsSuite) TestPostTrainingModuleDefaults(c *check.C) {
	module := TrainingModule{
		Title:            "安全辨識練習",
		Category:         TrainingCategoryRecognition,
		Difficulty:       "beginner",
		EstimatedMinutes: 5,
		OwnerId:          1,
	}
	c.Assert(PostTrainingModule(&module), check.Equals, nil)
	c.Assert(module.Id, check.Not(check.Equals), int64(0))
	c.Assert(module.Locale, check.Equals, TrainingLocaleZHTW)
	c.Assert(module.ContentType, check.Equals, TrainingContentMarkdown)
	c.Assert(module.Status, check.Equals, TrainingStatusDraft)
	c.Assert(module.Version, check.Equals, 1)
}

func (s *ModelsSuite) TestTrainingCategoryForResultStatus(c *check.C) {
	c.Assert(TrainingCategoryForResultStatus(EventClicked), check.Equals, TrainingCategoryRecognition)
	c.Assert(TrainingCategoryForResultStatus(EventDataSubmit), check.Equals, TrainingCategorySafeForm)
	c.Assert(TrainingCategoryForResultStatus(EventReported), check.Equals, TrainingCategoryReporting)
	c.Assert(TrainingCategoryForResultStatus(EventOpened), check.Equals, TrainingCategoryAdvanced)
}

func (s *ModelsSuite) TestAssignAndCompleteTrainingForResult(c *check.C) {
	campaign := s.createCampaign(c)
	module := TrainingModule{
		Title:            "安全處理登入與表單",
		Locale:           TrainingLocaleZHTW,
		Category:         TrainingCategorySafeForm,
		Difficulty:       "beginner",
		EstimatedMinutes: 6,
		ContentType:      TrainingContentMarkdown,
		ContentBody:      "不要在演練頁輸入真實密碼。",
		Status:           TrainingStatusPublished,
		OwnerId:          1,
	}
	c.Assert(PostTrainingModule(&module), check.Equals, nil)

	result := campaign.Results[0]
	assignment, err := AssignTrainingForResult(result, module, int64(1), TrainingCategoryForResultStatus(EventDataSubmit))
	c.Assert(err, check.Equals, nil)
	c.Assert(assignment.Status, check.Equals, TrainingAssignmentAssigned)
	c.Assert(assignment.ModuleId, check.Equals, module.Id)
	c.Assert(assignment.RId, check.Equals, result.RId)
	c.Assert(assignment.RecipientEmail, check.Equals, result.Email)

	completion, err := CompleteTrainingAssignment(assignment, 85, 80, 1, "web")
	c.Assert(err, check.Equals, nil)
	c.Assert(completion.Passed, check.Equals, true)
	c.Assert(completion.AttemptsCount, check.Equals, 1)
	c.Assert(EvaluateQuizPassing(70, 80), check.Equals, false)
}
