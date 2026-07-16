type RoboSatsLogoProps = {
  markOnly?: boolean;
};

export function RoboSatsLogo({ markOnly = false }: RoboSatsLogoProps) {
  if (!markOnly) {
    return (
      <picture className="robosats-logo-picture">
        <source media="(max-width: 520px)" srcSet="/static/assets/vector/R-notext.svg" />
        <img className="robosats-logo" src="/static/assets/vector/Robosats.svg" alt="RoboSats" />
      </picture>
    );
  }

  return (
    <img
      className="robosats-logo-mark"
      src="/static/assets/vector/R-notext.svg"
      alt="RoboSats"
    />
  );
}
