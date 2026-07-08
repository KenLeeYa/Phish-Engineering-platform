package models

import "errors"

var ErrDatabaseNotInitialized = errors.New("database is not initialized")

func HealthCheckDatabase() error {
	if db == nil {
		return ErrDatabaseNotInitialized
	}
	return db.DB().Ping()
}
