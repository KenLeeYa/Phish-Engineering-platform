package api

import (
	"net/http"
	"strconv"

	ctx "github.com/gophish/gophish/context"
	"github.com/gophish/gophish/models"
	"github.com/gorilla/mux"
)

// CampaignEnterpriseSummary returns an aggregate-first governed campaign report.
func (as *Server) CampaignEnterpriseSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
		return
	}
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := currentUser.HasAnyPermission(models.PermissionExportReports, models.PermissionViewTrainingCompletion, models.PermissionViewRecipientPII)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有檢視治理報表的權限"}, http.StatusForbidden)
		return
	}
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	summary, err := models.GetEnterpriseReportSummary(id, ctx.Get(r, "user_id").(int64), models.DefaultTrainingRiskWeights())
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	JSONResponse(w, summary, http.StatusOK)
}
