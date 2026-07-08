package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	ctx "github.com/gophish/gophish/context"
	log "github.com/gophish/gophish/logger"
	"github.com/gophish/gophish/models"
	"github.com/gorilla/mux"
	"github.com/jinzhu/gorm"
)

type campaignApprovalRequest struct {
	Notes  string `json:"notes"`
	Reason string `json:"reason"`
}

func hasCampaignPermission(u models.User, permission string) (bool, error) {
	return u.HasPermission(permission)
}

func campaignAuditSummary(c models.Campaign) string {
	return fmt.Sprintf("id=%d,name=%s,status=%s", c.Id, c.Name, c.Status)
}

func auditCampaignRequest(r *http.Request, action string, c models.Campaign, before string, after string) {
	user := ctx.Get(r, "user").(models.User)
	err := models.InsertAuditLog(&models.AuditLog{
		ActorUserID:   user.Id,
		ActorRole:     user.Role.Slug,
		Action:        action,
		EntityType:    "campaign",
		EntityID:      c.Id,
		BeforeSummary: before,
		AfterSummary:  after,
		IPAddress:     r.RemoteAddr,
		UserAgent:     r.UserAgent(),
		RequestID:     r.Header.Get("X-Request-Id"),
	})
	if err != nil {
		log.Errorf("error writing audit log: %v", err)
	}
}

// Campaigns returns a list of campaigns if requested via GET.
// If requested via POST, APICampaigns creates a new campaign and returns a reference to it.
func (as *Server) Campaigns(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == "GET":
		cs, err := models.GetCampaigns(ctx.Get(r, "user_id").(int64))
		if err != nil {
			log.Error(err)
		}
		JSONResponse(w, cs, http.StatusOK)
	//POST: Create a new campaign and return it as JSON
	case r.Method == "POST":
		currentUser := ctx.Get(r, "user").(models.User)
		allowed, err := hasCampaignPermission(currentUser, models.PermissionCreateCampaignDraft)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if !allowed {
			JSONResponse(w, models.Response{Success: false, Message: "沒有建立演練草稿的權限"}, http.StatusForbidden)
			return
		}
		c := models.Campaign{}
		// Put the request into a campaign
		err = json.NewDecoder(r.Body).Decode(&c)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Invalid JSON structure"}, http.StatusBadRequest)
			return
		}
		err = models.PostCampaign(&c, ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		auditCampaignRequest(r, models.AuditActionCampaignCreated, c, "", campaignAuditSummary(c))
		JSONResponse(w, c, http.StatusCreated)
	}
}

// CampaignsSummary returns the summary for the current user's campaigns
func (as *Server) CampaignsSummary(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == "GET":
		cs, err := models.GetCampaignSummaries(ctx.Get(r, "user_id").(int64))
		if err != nil {
			log.Error(err)
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		JSONResponse(w, cs, http.StatusOK)
	}
}

// Campaign returns details about the requested campaign. If the campaign is not
// valid, APICampaign returns null.
func (as *Server) Campaign(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	c, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		log.Error(err)
		JSONResponse(w, models.Response{Success: false, Message: "Campaign not found"}, http.StatusNotFound)
		return
	}
	switch {
	case r.Method == "GET":
		JSONResponse(w, c, http.StatusOK)
	case r.Method == "DELETE":
		currentUser := ctx.Get(r, "user").(models.User)
		allowed, err := hasCampaignPermission(currentUser, models.PermissionCreateCampaignDraft)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if !allowed {
			JSONResponse(w, models.Response{Success: false, Message: "沒有刪除演練活動的權限"}, http.StatusForbidden)
			return
		}
		before := campaignAuditSummary(c)
		err = models.DeleteCampaign(id)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Error deleting campaign"}, http.StatusInternalServerError)
			return
		}
		auditCampaignRequest(r, models.AuditActionCampaignDeleted, c, before, "deleted")
		JSONResponse(w, models.Response{Success: true, Message: "演練活動已刪除"}, http.StatusOK)
	}
}

// CampaignResults returns just the results for a given campaign to
// significantly reduce the information returned.
func (as *Server) CampaignResults(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	cr, err := models.GetCampaignResults(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		log.Error(err)
		JSONResponse(w, models.Response{Success: false, Message: "Campaign not found"}, http.StatusNotFound)
		return
	}
	if r.Method == "GET" {
		JSONResponse(w, cr, http.StatusOK)
		return
	}
}

// CampaignDelivery returns governed per-recipient delivery status for a campaign.
func (as *Server) CampaignDelivery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := currentUser.HasAnyPermission(models.PermissionViewRecipientPII, models.PermissionLaunchCampaign, models.PermissionExportReports)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有檢視配送狀態的權限"}, http.StatusForbidden)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	_, err = models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		log.Error(err)
		JSONResponse(w, models.Response{Success: false, Message: "Campaign not found"}, http.StatusNotFound)
		return
	}
	statuses, err := models.GetDeliveryStatusesByCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		log.Error(err)
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	JSONResponse(w, statuses, http.StatusOK)
}

// CampaignSummary returns the summary for a given campaign.
func (as *Server) CampaignSummary(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	switch {
	case r.Method == "GET":
		cs, err := models.GetCampaignSummary(id, ctx.Get(r, "user_id").(int64))
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				JSONResponse(w, models.Response{Success: false, Message: "Campaign not found"}, http.StatusNotFound)
			} else {
				JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			}
			log.Error(err)
			return
		}
		JSONResponse(w, cs, http.StatusOK)
	}
}

// CampaignSubmit submits a draft campaign for approval.
func (as *Server) CampaignSubmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := hasCampaignPermission(currentUser, models.PermissionCreateCampaignDraft)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有提交演練審核的權限"}, http.StatusForbidden)
		return
	}
	beforeCampaign, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "找不到演練活動"}, http.StatusNotFound)
		return
	}
	before := campaignAuditSummary(beforeCampaign)
	err = models.SubmitCampaignForApproval(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
		return
	}
	afterCampaign, _ := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	auditCampaignRequest(r, models.AuditActionCampaignSubmitted, afterCampaign, before, campaignAuditSummary(afterCampaign))
	JSONResponse(w, afterCampaign, http.StatusOK)
}

// CampaignApprove approves a pending campaign.
func (as *Server) CampaignApprove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := hasCampaignPermission(currentUser, models.PermissionApproveCampaign)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有審核演練活動的權限"}, http.StatusForbidden)
		return
	}
	req := campaignApprovalRequest{}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}
	beforeCampaign, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "找不到演練活動"}, http.StatusNotFound)
		return
	}
	before := campaignAuditSummary(beforeCampaign)
	err = models.ApproveCampaign(id, ctx.Get(r, "user_id").(int64), currentUser.Id, req.Notes)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
		return
	}
	afterCampaign, _ := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	auditCampaignRequest(r, models.AuditActionCampaignApproved, afterCampaign, before, campaignAuditSummary(afterCampaign))
	JSONResponse(w, afterCampaign, http.StatusOK)
}

// CampaignReject rejects a pending campaign.
func (as *Server) CampaignReject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := hasCampaignPermission(currentUser, models.PermissionApproveCampaign)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有退回演練活動的權限"}, http.StatusForbidden)
		return
	}
	req := campaignApprovalRequest{}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}
	beforeCampaign, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "找不到演練活動"}, http.StatusNotFound)
		return
	}
	before := campaignAuditSummary(beforeCampaign)
	err = models.RejectCampaign(id, ctx.Get(r, "user_id").(int64), req.Reason)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
		return
	}
	afterCampaign, _ := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	auditCampaignRequest(r, models.AuditActionCampaignRejected, afterCampaign, before, campaignAuditSummary(afterCampaign))
	JSONResponse(w, afterCampaign, http.StatusOK)
}

// CampaignLaunch launches an approved campaign.
func (as *Server) CampaignLaunch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := hasCampaignPermission(currentUser, models.PermissionLaunchCampaign)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有啟動演練活動的權限"}, http.StatusForbidden)
		return
	}
	beforeCampaign, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "找不到演練活動"}, http.StatusNotFound)
		return
	}
	before := campaignAuditSummary(beforeCampaign)
	c, err := models.LaunchApprovedCampaign(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
		return
	}
	auditCampaignRequest(r, models.AuditActionCampaignLaunched, c, before, campaignAuditSummary(c))
	if c.Status == models.CampaignInProgress {
		go as.worker.LaunchCampaign(c)
	}
	JSONResponse(w, c, http.StatusOK)
}

// CampaignComplete effectively "ends" a campaign.
// Future phishing emails clicked will return a simple "404" page.
func (as *Server) CampaignComplete(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	switch {
	case r.Method == "GET":
		currentUser := ctx.Get(r, "user").(models.User)
		allowed, err := hasCampaignPermission(currentUser, models.PermissionPauseCompleteCampaign)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if !allowed {
			JSONResponse(w, models.Response{Success: false, Message: "沒有完成演練活動的權限"}, http.StatusForbidden)
			return
		}
		beforeCampaign, err := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "找不到演練活動"}, http.StatusNotFound)
			return
		}
		before := campaignAuditSummary(beforeCampaign)
		err = models.CompleteCampaign(id, ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Error completing campaign"}, http.StatusInternalServerError)
			return
		}
		afterCampaign, _ := models.GetCampaign(id, ctx.Get(r, "user_id").(int64))
		auditCampaignRequest(r, models.AuditActionCampaignCompleted, afterCampaign, before, campaignAuditSummary(afterCampaign))
		JSONResponse(w, models.Response{Success: true, Message: "演練活動已完成"}, http.StatusOK)
	}
}
