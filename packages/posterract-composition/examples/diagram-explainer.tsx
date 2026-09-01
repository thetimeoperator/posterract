/** @jsxImportSource @posterract/composition */

export default function DiagramExplainer() {
  const curve = Array.from({ length: 41 }, (_, index) => {
    const x = index / 4;
    return [x, Math.sin(x)] as const;
  });

  return (
    <stage id="workspace" background="#03100B">
      <scene id="diagram-demo" name="Agent-designed diagram" width={1280} height={720} active fill="#06110D">
        <diagramNode id="prompt" name="User instruction" x={80} y={110} width={310} height={130}
          label="User instruction" subtitle="Explain the signal" shape="rounded" fill="#0B2118" />
        <diagramArrow id="prompt-arrow" name="Instruction flow" x={390} y={175} width={180} height={0}
          label="agent designs" route="straight" />
        <diagramNode id="model" name="Posterract agent" x={570} y={110} width={310} height={130}
          label="Posterract agent" subtitle="Plans + verifies" shape="hexagon" fill="#10291F" />
        <diagramArrow id="model-arrow" name="Diagram output" x={880} y={175} width={210} height={0}
          label="renders" route="straight" />
        <diagramCallout id="result" name="Verified result" x={1090} y={95} width={150} height={160}
          label="Verified" subtitle="capture checked" fill="#0B2118" targetX={75} targetY={205} />

        <diagramAxis id="axis" name="Signal axes" x={160} y={315} width={900} height={330}
          domain={[0, 10]} range={[-1, 1]} tickCount={5} grid xLabel="time" yLabel="signal" />
        <diagramPlot id="curve" name="Signal plot" x={160} y={315} width={900} height={330}
          points={curve} domain={[0, 10]} range={[-1, 1]} smooth strokeColor="#71F7C4" strokeWidth={5} />
        <diagramEquation id="equation" name="Signal equation" x={930} y={405} width={300} height={110}
          expression="y = sin(x)" label="deterministic points" fontSize={36} />
      </scene>
    </stage>
  );
}
