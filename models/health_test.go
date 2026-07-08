package models

import check "gopkg.in/check.v1"

func (s *ModelsSuite) TestHealthCheckDatabase(c *check.C) {
	c.Assert(HealthCheckDatabase(), check.Equals, nil)
}
