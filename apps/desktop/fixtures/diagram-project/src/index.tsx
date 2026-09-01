/** @jsxImportSource @posterract/composition */

export default function DiagramDemo() {
  const curve = Array.from({ length: 41 }, (_, index) => {
    const x = index / 4;
    return [x, Math.sin(x)] as const;
  });

  return (
    <stage id="workspace" background="#03100B" camera={[0.52, 0, 0, 0.52, 121.89, 71.7]}>
      <scene id="diagram-demo" name="Agent Diagram Demo" width={1280} height={720} active fill="#06110D">
        <diagramNode id="prompt" name="User instruction" x={70} y={85} width={300} height={130}
          label="User instruction" subtitle="Explain the signal" shape="rounded" fill="#0B2118" />
        <diagramArrow id="prompt-arrow" name="Instruction flow" x={370} y={150} width={170} height={0}
          label="agent designs" route="straight" />
        <diagramNode id="agent" name="Posterract agent" x={540} y={85} width={300} height={130}
          label="Posterract agent" subtitle="Plans + verifies" shape="hexagon" fill="#10291F" />
        <diagramArrow id="agent-arrow" name="Diagram output" x={840} y={150} width={170} height={0}
          label="renders" route="straight" />
        <diagramCallout id="result" name="Verified result" x={1010} y={70} width={200} height={160}
          label="Verified" subtitle="capture checked" fill="#0B2118" targetX={100} targetY={205} />

        <diagramEquation id="equation" name="Signal equation" x={960} y={390} width={290} height={120}
          expression="y = sin(x)" label="deterministic points" fontSize={36} />
        <rect id="f69i2c" name="Rect 1" x={380} y={426} width={248} height={108} selected>
          <solidPaint id="rdshr6" color="#E0E0E0" />
        </rect>
      </scene>
    </stage>
  );
}
