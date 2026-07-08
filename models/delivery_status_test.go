package models

import (
	"errors"
	"time"

	check "gopkg.in/check.v1"
)

func (s *ModelsSuite) TestPostCampaignCreatesDeliveryStatuses(c *check.C) {
	campaign := s.createCampaign(c)
	statuses, err := GetDeliveryStatusesByCampaign(campaign.Id, campaign.UserId)
	c.Assert(err, check.Equals, nil)
	c.Assert(len(statuses), check.Equals, len(campaign.Results))

	for _, status := range statuses {
		c.Assert(status.CampaignId, check.Equals, campaign.Id)
		c.Assert(status.UserId, check.Equals, campaign.UserId)
		c.Assert(status.RId, check.Not(check.Equals), "")
		c.Assert(status.Email, check.Not(check.Equals), "")
		c.Assert(status.SendingProfileId, check.Equals, campaign.SMTPId)
		c.Assert(status.Status, check.Equals, DeliveryStatusQueued)
	}
}

func (s *ModelsSuite) TestDeliveryStatusTransitions(c *check.C) {
	campaign := s.createCampaign(c)
	result := campaign.Results[0]

	err := result.HandleEmailSent()
	c.Assert(err, check.Equals, nil)
	statuses, err := GetDeliveryStatusesByCampaign(campaign.Id, campaign.UserId)
	c.Assert(err, check.Equals, nil)
	c.Assert(statuses[0].Status, check.Equals, DeliveryStatusSent)
	c.Assert(statuses[0].LastErrorSummary, check.Equals, "")

	result = campaign.Results[1]
	err = result.HandleEmailBackoff(errors.New("temporary smtp failure"), time.Now().UTC().Add(time.Minute))
	c.Assert(err, check.Equals, nil)
	statuses, err = GetDeliveryStatusesByCampaign(campaign.Id, campaign.UserId)
	c.Assert(err, check.Equals, nil)
	c.Assert(statuses[1].Status, check.Equals, DeliveryStatusDeferred)
	c.Assert(statuses[1].RetryCount, check.Equals, 1)
	c.Assert(statuses[1].LastErrorSummary, check.Equals, "temporary smtp failure")

	result = campaign.Results[2]
	err = result.HandleEmailError(errors.New("permanent smtp failure"))
	c.Assert(err, check.Equals, nil)
	statuses, err = GetDeliveryStatusesByCampaign(campaign.Id, campaign.UserId)
	c.Assert(err, check.Equals, nil)
	c.Assert(statuses[2].Status, check.Equals, DeliveryStatusFailed)
	c.Assert(statuses[2].RetryCount, check.Equals, 1)
	c.Assert(statuses[2].LastErrorSummary, check.Equals, "permanent smtp failure")
}
