/** @jsxImportSource @posterract/composition */

export default function Project() {
  return (
    <stage id="workspace" background="#020604">
      <scene id="portrait" name="Portrait cut" width={1080} height={1920} active>
        <text id="portrait-title" x={80} y={160} width={920} height={200} fontSize={88}>Portrait</text>
      </scene>
      <scene id="landscape" name="Landscape cut" width={1920} height={1080}>
        <text id="landscape-title" x={120} y={120} width={1680} height={180} fontSize={92}>Landscape</text>
      </scene>
    </stage>
  );
}
