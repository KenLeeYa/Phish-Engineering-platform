package api

import (
	"encoding/json"
	"net/http"

	ctx "github.com/gophish/gophish/context"
	"github.com/gophish/gophish/models"
)

// TrainingModules provides minimal training module library API support.
func (as *Server) TrainingModules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		modules, err := models.GetTrainingModules(r.URL.Query().Get("locale"))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		JSONResponse(w, modules, http.StatusOK)
	case http.MethodPost:
		currentUser := ctx.Get(r, "user").(models.User)
		allowed, err := currentUser.HasPermission(models.PermissionManageTrainingContent)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if !allowed {
			JSONResponse(w, models.Response{Success: false, Message: "沒有管理訓練內容的權限"}, http.StatusForbidden)
			return
		}
		module := models.TrainingModule{}
		err = json.NewDecoder(r.Body).Decode(&module)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Invalid request"}, http.StatusBadRequest)
			return
		}
		module.OwnerId = ctx.Get(r, "user_id").(int64)
		err = models.PostTrainingModule(&module)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		JSONResponse(w, module, http.StatusCreated)
	default:
		JSONResponse(w, models.Response{Success: false, Message: http.StatusText(http.StatusMethodNotAllowed)}, http.StatusMethodNotAllowed)
	}
}
