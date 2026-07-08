package controllers

import (
	"net/http"

	"github.com/gophish/gophish/controllers/api"
	"github.com/gophish/gophish/models"
)

type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

func (as *AdminServer) Healthz(w http.ResponseWriter, r *http.Request) {
	api.JSONResponse(w, healthResponse{Status: "ok"}, http.StatusOK)
}

func (as *AdminServer) Readyz(w http.ResponseWriter, r *http.Request) {
	err := models.HealthCheckDatabase()
	if err != nil {
		api.JSONResponse(w, healthResponse{Status: "error", Database: err.Error()}, http.StatusServiceUnavailable)
		return
	}
	api.JSONResponse(w, healthResponse{Status: "ok", Database: "ok"}, http.StatusOK)
}
