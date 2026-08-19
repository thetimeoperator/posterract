import { useEffect, useState } from "react";
import { listPublicSkills, REMOTE_HARNESS } from "./client";
import { PUBLIC_SKILLS, type PublicSkill } from "./catalog";

/** Cloud mode treats the API registry as truth while preserving local visual metadata. */
export function usePublicSkills() {
  const [skills, setSkills] = useState<PublicSkill[]>(PUBLIC_SKILLS);

  useEffect(() => {
    if (!REMOTE_HARNESS) return;
    void listPublicSkills()
      .then((remoteSkills) => {
        setSkills(remoteSkills.map((remote) => {
          const local = PUBLIC_SKILLS.find((skill) => skill.id === remote.id);
          return {
            ...local,
            ...remote,
            category: remote.category as PublicSkill["category"],
            accent: local?.accent ?? "#65ff9a",
            inputs: remote.inputs ?? local?.inputs ?? [],
            platforms: remote.platforms ?? local?.platforms ?? [],
            stages: remote.stages ?? local?.stages ?? 1,
          } as PublicSkill;
        }));
      })
      .catch(() => undefined);
  }, []);

  return skills;
}
