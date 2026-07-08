package api

import (
	"encoding/json"
	"net/http"

	ctx "github.com/gophish/gophish/context"
	"github.com/gophish/gophish/models"
)

// Integrations provides a minimal enterprise integration registry API.
func (as *Server) Integrations(w http.ResponseWriter, r *http.Request) {
	currentUser := ctx.Get(r, "user").(models.User)
	allowed, err := currentUser.HasPermission(models.PermissionManageWebhooks)
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
		return
	}
	if !allowed {
		JSONResponse(w, models.Response{Success: false, Message: "沒有管理整合設定的權限"}, http.StatusForbidden)
		return
	}
	switch r.Method {
	case http.MethodGet:
		integrations, err := models.GetEnterpriseIntegrations()
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		JSONResponse(w, models.SanitizeIntegrationsForResponse(integrations), http.StatusOK)
	case http.MethodPost:
		integration := models.EnterpriseIntegration{}
		err := json.NewDecoder(r.Body).Decode(&integration)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Invalid request"}, http.StatusBadRequest)
			return
		}
		integration.CreatedBy = ctx.Get(r, "user_id").(int64)
		integration.UpdatedBy = integration.CreatedBy
		err = models.PostEnterpriseIntegration(&integration)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		JSONResponse(w, models.SanitizeIntegrationForResponse(integration), http.StatusCreated)
	default:
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
	}
}
