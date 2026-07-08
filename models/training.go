package models

import (
	"errors"
	"time"
)

const (
	TrainingLocaleZHTW = "zh-TW"

	TrainingContentArticle     = "article"
	TrainingContentVideoURL    = "video_url"
	TrainingContentMarkdown    = "markdown"
	TrainingContentHTMLSafe    = "html_safe"
	TrainingContentQuiz        = "quiz"
	TrainingContentExternalLMS = "external_lms"

	TrainingStatusDraft     = "draft"
	TrainingStatusReview    = "review"
	TrainingStatusPublished = "published"
	TrainingStatusArchived  = "archived"

	TrainingAssignmentAssigned  = "assigned"
	TrainingAssignmentCompleted = "completed"

	TrainingCategoryRecognition = "phishing_recognition"
	TrainingCategorySafeForm    = "safe_form_handling"
	TrainingCategoryReporting   = "positive_reinforcement"
	TrainingCategoryAdvanced    = "advanced_awareness"
)

var ErrTrainingModuleRequired = errors.New("Training module is required")

type TrainingModule struct {
	Id               int64     `json:"id"`
	Title            string    `json:"title"`
	Locale           string    `json:"locale"`
	Category         string    `json:"category"`
	Difficulty       string    `json:"difficulty"`
	EstimatedMinutes int       `json:"estimated_minutes"`
	ContentType      string    `json:"content_type"`
	ContentBody      string    `json:"content_body"`
	ExternalURL      string    `json:"external_url"`
	Status           string    `json:"status"`
	Version          int       `json:"version"`
	OwnerId          int64     `json:"owner_id"`
	ReviewerId       int64     `json:"reviewer_id"`
	ReviewedAt       time.Time `json:"reviewed_at"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type TrainingLesson struct {
	Id        int64     `json:"id"`
	ModuleId  int64     `json:"module_id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Quiz struct {
	Id           int64     `json:"id"`
	ModuleId     int64     `json:"module_id"`
	Title        string    `json:"title"`
	PassingScore int       `json:"passing_score"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type QuizQuestion struct {
	Id           int64     `json:"id"`
	QuizId       int64     `json:"quiz_id"`
	QuestionText string    `json:"question_text"`
	QuestionType string    `json:"question_type"`
	Points       int       `json:"points"`
	SortOrder    int       `json:"sort_order"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type QuizAnswer struct {
	Id             int64     `json:"id"`
	QuestionId     int64     `json:"question_id"`
	AnswerText      string    `json:"answer_text"`
	IsCorrect       bool      `json:"is_correct"`
	ExplanationText string    `json:"explanation_text"`
	SortOrder       int       `json:"sort_order"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type TrainingAssignment struct {
	Id             int64     `json:"id"`
	CampaignId     int64     `json:"campaign_id"`
	ResultId       int64     `json:"result_id"`
	RId            string    `json:"recipient_result_id"`
	RecipientEmail string    `json:"recipient_email"`
	ModuleId       int64     `json:"module_id"`
	AssignedBy     int64     `json:"assigned_by"`
	Status         string    `json:"status"`
	Reason         string    `json:"reason"`
	AssignedAt     time.Time `json:"assigned_at"`
	DueAt          time.Time `json:"due_at"`
}

type TrainingCompletion struct {
	Id             int64     `json:"id"`
	AssignmentId   int64     `json:"assignment_id"`
	ModuleId       int64     `json:"module_id"`
	RId            string    `json:"recipient_result_id"`
	Score          int       `json:"score"`
	Passed         bool      `json:"passed"`
	AttemptsCount  int       `json:"attempts_count"`
	CompletedAt    time.Time `json:"completed_at"`
	CompletionSource string  `json:"completion_source"`
}

type TrainingFeedback struct {
	Id           int64     `json:"id"`
	AssignmentId int64     `json:"assignment_id"`
	ModuleId     int64     `json:"module_id"`
	RId          string    `json:"recipient_result_id"`
	Rating       int       `json:"rating"`
	Comment      string    `json:"comment"`
	CreatedAt    time.Time `json:"created_at"`
}

func PostTrainingModule(m *TrainingModule) error {
	now := time.Now().UTC()
	if m.Locale == "" {
		m.Locale = TrainingLocaleZHTW
	}
	if m.ContentType == "" {
		m.ContentType = TrainingContentMarkdown
	}
	if m.Status == "" {
		m.Status = TrainingStatusDraft
	}
	if m.Version == 0 {
		m.Version = 1
	}
	if m.CreatedAt.IsZero() {
		m.CreatedAt = now
	}
	m.UpdatedAt = now
	return db.Save(m).Error
}

func GetTrainingModules(locale string) ([]TrainingModule, error) {
	if locale == "" {
		locale = TrainingLocaleZHTW
	}
	modules := []TrainingModule{}
	err := db.Where("locale=?", locale).Order("category asc, title asc").Find(&modules).Error
	return modules, err
}

func TrainingCategoryForResultStatus(status string) string {
	switch status {
	case EventClicked:
		return TrainingCategoryRecognition
	case EventDataSubmit:
		return TrainingCategorySafeForm
	case EventReported:
		return TrainingCategoryReporting
	default:
		return TrainingCategoryAdvanced
	}
}

func AssignTrainingForResult(result Result, module TrainingModule, assignedBy int64, reason string) (TrainingAssignment, error) {
	assignment := TrainingAssignment{}
	if module.Id == 0 {
		return assignment, ErrTrainingModuleRequired
	}
	now := time.Now().UTC()
	assignment = TrainingAssignment{
		CampaignId:     result.CampaignId,
		ResultId:       result.Id,
		RId:            result.RId,
		RecipientEmail: result.Email,
		ModuleId:       module.Id,
		AssignedBy:     assignedBy,
		Status:         TrainingAssignmentAssigned,
		Reason:         reason,
		AssignedAt:     now,
		DueAt:          now.AddDate(0, 0, 14),
	}
	err := db.Save(&assignment).Error
	return assignment, err
}

func EvaluateQuizPassing(score int, passingScore int) bool {
	return score >= passingScore
}

func CompleteTrainingAssignment(assignment TrainingAssignment, score int, passingScore int, attempts int, source string) (TrainingCompletion, error) {
	now := time.Now().UTC()
	completion := TrainingCompletion{
		AssignmentId:     assignment.Id,
		ModuleId:         assignment.ModuleId,
		RId:              assignment.RId,
		Score:            score,
		Passed:           EvaluateQuizPassing(score, passingScore),
		AttemptsCount:    attempts,
		CompletedAt:      now,
		CompletionSource: source,
	}
	err := db.Save(&completion).Error
	if err != nil {
		return completion, err
	}
	assignment.Status = TrainingAssignmentCompleted
	err = db.Save(&assignment).Error
	return completion, err
}
