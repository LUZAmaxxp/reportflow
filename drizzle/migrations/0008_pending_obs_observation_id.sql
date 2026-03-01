-- Add observation_id back-reference to pending_manual_observation
-- Required by Slice 5 §5.8: POST confirm writes observation_id; GET returns it.
ALTER TABLE pending_manual_observation
  ADD COLUMN observation_id uuid NULL
    REFERENCES observation(observation_id) ON DELETE SET NULL;

CREATE INDEX pending_manual_observation_obs_partial_idx
  ON pending_manual_observation (observation_id)
  WHERE observation_id IS NOT NULL;
