package models

import (
	"net/url"

	check "gopkg.in/check.v1"
)

func (s *ModelsSuite) TestLandingPageSubmissionModeDefault(c *check.C) {
	mode := GetLandingPageSubmissionMode()
	c.Assert(mode, check.Equals, LandingPageSubmissionMetricsOnly)
}

func (s *ModelsSuite) TestSanitizeLandingPagePayloadMetricsOnly(c *check.C) {
	payload := url.Values{
		RecipientParameter: {"abc123"},
		"username":         {"alice"},
		"password":         {"real-password"},
	}
	got := SanitizeLandingPagePayload(payload, LandingPageSubmissionMetricsOnly)
	c.Assert(got.Get("submission_mode"), check.Equals, LandingPageSubmissionMetricsOnly)
	c.Assert(got.Get("submitted"), check.Equals, "true")
	c.Assert(got.Get("username"), check.Equals, "")
	c.Assert(got.Get("password"), check.Equals, "")
	c.Assert(got.Get(RecipientParameter), check.Equals, "")
}

func (s *ModelsSuite) TestSanitizeLandingPagePayloadRedactSensitive(c *check.C) {
	payload := url.Values{
		RecipientParameter: {"abc123"},
		"username":         {"alice"},
		"password":         {"real-password"},
		"session_token":    {"secret-token"},
	}
	got := SanitizeLandingPagePayload(payload, LandingPageSubmissionRedactSensitive)
	c.Assert(got.Get("submission_mode"), check.Equals, LandingPageSubmissionRedactSensitive)
	c.Assert(got.Get("username"), check.Equals, "alice")
	c.Assert(got.Get("password"), check.Equals, RedactedValue)
	c.Assert(got.Get("session_token"), check.Equals, RedactedValue)
	c.Assert(got.Get(RecipientParameter), check.Equals, "")
}

func (s *ModelsSuite) TestSanitizeLandingPagePayloadDisabled(c *check.C) {
	payload := url.Values{
		"username": {"alice"},
		"password": {"real-password"},
	}
	got := SanitizeLandingPagePayload(payload, LandingPageSubmissionDisabled)
	c.Assert(got.Get("submission_mode"), check.Equals, LandingPageSubmissionDisabled)
	c.Assert(got.Get("submitted"), check.Equals, "true")
	c.Assert(got.Get("username"), check.Equals, "")
	c.Assert(got.Get("password"), check.Equals, "")
}

func (s *ModelsSuite) TestSensitiveFieldNames(c *check.C) {
	sensitive := []string{"password", "session-token", "api key", "一次性密碼", "信用卡號"}
	for _, name := range sensitive {
		c.Assert(IsSensitiveFieldName(name), check.Equals, true)
	}
	c.Assert(IsSensitiveFieldName("department"), check.Equals, false)
}
