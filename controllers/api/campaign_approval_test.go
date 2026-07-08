package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gophish/gophish/models"
)

type testWorker struct {
	launched []models.Campaign
}

func (w *testWorker) Start() {}

func (w *testWorker) LaunchCampaign(c models.Campaign) {
	w.launched = append(w.launched, c)
}

func (w *testWorker) SendTestEmail(s *models.EmailRequest) error {
	return nil
}

func createApprovalCampaign(t *testing.T) models.Campaign {
	group := models.Group{Name: "Approval Test Group"}
	group.Targets = []models.Target{
		{BaseRecipient: models.BaseRecipient{Email: "test1@example.com", FirstName: "First", LastName: "Example"}},
	}
	group.UserId = 1
	if err := models.PostGroup(&group); err != nil {
		t.Fatalf("error posting group: %v", err)
	}
	template := models.Template{Name: "Approval Test Template", Subject: "Subject", Text: "Text", HTML: "<html>Test</html>", UserId: 1}
	if err := models.PostTemplate(&template); err != nil {
		t.Fatalf("error posting template: %v", err)
	}
	page := models.Page{Name: "Approval Test Page", HTML: "<html>Test</html>", UserId: 1}
	if err := models.PostPage(&page); err != nil {
		t.Fatalf("error posting page: %v", err)
	}
	smtp := models.SMTP{Name: "Approval Test SMTP", Host: "example.com", FromAddress: "test@test.com", UserId: 1, ApprovedForUse: true}
	if err := models.PostSMTP(&smtp); err != nil {
		t.Fatalf("error posting smtp: %v", err)
	}
	campaign := models.Campaign{
		Name:       "Approval Test Campaign",
		UserId:     1,
		Template:   template,
		Page:       page,
		SMTP:       smtp,
		Groups:     []models.Group{group},
		LaunchDate: time.Now().UTC().Add(-time.Minute),
	}
	if err := models.PostCampaign(&campaign, campaign.UserId); err != nil {
		t.Fatalf("error posting campaign: %v", err)
	}
	return campaign
}

func campaignActionRequest(method string, path string, apiKey string, body interface{}) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestCampaignApprovalWorkflowAPI(t *testing.T) {
	testCtx := setupTest(t)
	worker := &testWorker{}
	testCtx.apiServer = NewServer(WithWorker(worker))
	campaign := createApprovalCampaign(t)

	launchURL := fmt.Sprintf("/api/campaigns/%d/launch", campaign.Id)
	w := httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, launchURL, testCtx.apiKey, nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected launch before approval to fail with %d got %d", http.StatusBadRequest, w.Code)
	}

	submitURL := fmt.Sprintf("/api/campaigns/%d/submit", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, submitURL, testCtx.apiKey, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected submit to succeed with %d got %d", http.StatusOK, w.Code)
	}

	approveURL := fmt.Sprintf("/api/campaigns/%d/approve", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, approveURL, testCtx.apiKey, campaignApprovalRequest{Notes: "approved"}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected approve to succeed with %d got %d", http.StatusOK, w.Code)
	}

	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, launchURL, testCtx.apiKey, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected launch to succeed with %d got %d", http.StatusOK, w.Code)
	}
	if len(worker.launched) != 1 {
		t.Fatalf("expected one worker launch got %d", len(worker.launched))
	}

	logs, err := models.GetAuditLogs()
	if err != nil {
		t.Fatalf("error getting audit logs: %v", err)
	}
	if len(logs) != 3 {
		t.Fatalf("expected 3 audit logs got %d", len(logs))
	}
	expectedActions := []string{
		models.AuditActionCampaignSubmitted,
		models.AuditActionCampaignApproved,
		models.AuditActionCampaignLaunched,
	}
	for i, action := range expectedActions {
		if logs[i].Action != action {
			t.Fatalf("expected audit action %s got %s", action, logs[i].Action)
		}
	}
}

func TestCampaignRejectRequiresReasonAPI(t *testing.T) {
	testCtx := setupTest(t)
	campaign := createApprovalCampaign(t)

	submitURL := fmt.Sprintf("/api/campaigns/%d/submit", campaign.Id)
	w := httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, submitURL, testCtx.apiKey, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected submit to succeed with %d got %d", http.StatusOK, w.Code)
	}

	rejectURL := fmt.Sprintf("/api/campaigns/%d/reject", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, rejectURL, testCtx.apiKey, campaignApprovalRequest{}))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected reject without reason to fail with %d got %d", http.StatusBadRequest, w.Code)
	}
}

func TestCampaignCreatorCannotApproveAPI(t *testing.T) {
	testCtx := setupTest(t)
	campaign := createApprovalCampaign(t)
	creator := createUnpriviledgedUser(t, models.RoleCampaignCreator)

	submitURL := fmt.Sprintf("/api/campaigns/%d/submit", campaign.Id)
	w := httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, submitURL, testCtx.apiKey, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected submit to succeed with %d got %d", http.StatusOK, w.Code)
	}

	approveURL := fmt.Sprintf("/api/campaigns/%d/approve", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, approveURL, creator.ApiKey, campaignApprovalRequest{Notes: "approved"}))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected unauthorized approve to fail with %d got %d", http.StatusForbidden, w.Code)
	}
}

func TestCampaignCreatorCannotLaunchAPI(t *testing.T) {
	testCtx := setupTest(t)
	campaign := createApprovalCampaign(t)
	creator := createUnpriviledgedUser(t, models.RoleCampaignCreator)

	submitURL := fmt.Sprintf("/api/campaigns/%d/submit", campaign.Id)
	w := httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, submitURL, testCtx.apiKey, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected submit to succeed with %d got %d", http.StatusOK, w.Code)
	}

	approveURL := fmt.Sprintf("/api/campaigns/%d/approve", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, approveURL, testCtx.apiKey, campaignApprovalRequest{Notes: "approved"}))
	if w.Code != http.StatusOK {
		t.Fatalf("expected approve to succeed with %d got %d", http.StatusOK, w.Code)
	}

	launchURL := fmt.Sprintf("/api/campaigns/%d/launch", campaign.Id)
	w = httptest.NewRecorder()
	testCtx.apiServer.ServeHTTP(w, campaignActionRequest(http.MethodPost, launchURL, creator.ApiKey, nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected unauthorized launch to fail with %d got %d", http.StatusForbidden, w.Code)
	}
}
