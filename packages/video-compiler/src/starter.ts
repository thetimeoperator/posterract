export const POSTERRACT_STARTER_SOURCE = `/* @jsxImportSource @posterract/composition */

export default function PosterractProject() {
  return (
    <stage id="stage" background="#020604" camera={[0.44, 0, 0, 0.44, 210, 36]}>
      <scene id="main" name="Main" width={1080} height={1920} fill="#03100b" active>
        <rect id="signal" x={72} y={220} width={936} height={1480} cornerRadius={56} fill="#071b13" />
        <rect id="accent" x={72} y={220} width={18} height={1480} cornerRadius={9} fill="#65ff9a" />
        <text
          id="eyebrow"
          x={142}
          y={360}
          width={800}
          height={74}
          fontFamily="JetBrains Mono"
          fontSize={30}
          color="#65ff9a"
        >
          AGENT-NATIVE VIDEO
        </text>
        <text
          id="headline"
          x={142}
          y={490}
          width={790}
          height={500}
          fontFamily="Inter"
          fontSize={104}
          fontWeight="bold"
          color="#f2fff6"
        >
          Create with Posterract.
        </text>
        <text
          id="subhead"
          x={142}
          y={1120}
          width={760}
          height={220}
          fontFamily="Inter"
          fontSize={42}
          color="#9abaaa"
        >
          Edit the canvas. Edit the code. Your agent sees the same project.
        </text>
      </scene>
    </stage>
  );
}
`;
