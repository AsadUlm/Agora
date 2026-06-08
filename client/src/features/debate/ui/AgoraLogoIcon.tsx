export default function AgoraLogoIcon({ size = 36, className }: { size?: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <defs>
                <linearGradient id="agora-bg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366f1" />
                    <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
            </defs>

            <rect width="36" height="36" rx="9" fill="url(#agora-bg)" />

            {/* Scale inner content with more breathing room */}
            <g transform="translate(5, 5) scale(0.722)">

            {/* ── Left speech bubble ── */}
            <rect x="1.5" y="2" width="14" height="9" rx="2.5" fill="white" fillOpacity="0.95" />
            {/* Tail pointing down-right toward left robot's face */}
            <path d="M 11.5 11 L 14 15 L 8.5 11 Z" fill="white" fillOpacity="0.95" />
            <circle cx="5.5" cy="6.5" r="1.1" fill="#6366f1" fillOpacity="0.55" />
            <circle cx="8.5" cy="6.5" r="1.1" fill="#6366f1" fillOpacity="0.55" />
            <circle cx="11.5" cy="6.5" r="1.1" fill="#6366f1" fillOpacity="0.55" />

            {/* ── Right speech bubble ── */}
            <rect x="20.5" y="2" width="14" height="9" rx="2.5" fill="white" fillOpacity="0.7" />
            {/* Tail pointing down-left toward right robot's face */}
            <path d="M 24.5 11 L 22 15 L 27.5 11 Z" fill="white" fillOpacity="0.7" />
            <circle cx="24.5" cy="6.5" r="1.1" fill="#7c3aed" fillOpacity="0.5" />
            <circle cx="27.5" cy="6.5" r="1.1" fill="#7c3aed" fillOpacity="0.5" />
            <circle cx="30.5" cy="6.5" r="1.1" fill="#7c3aed" fillOpacity="0.5" />

            {/* ══ Left robot — round skull profile, facing right ══ */}

            {/* Antenna — toward back/top of head */}
            <rect x="5.5" y="14" width="1.5" height="4" rx="0.6" fill="white" fillOpacity="0.9" />
            <circle cx="6.25" cy="13.2" r="1.4" fill="white" fillOpacity="0.9" />

            {/* Round skull */}
            <ellipse cx="9" cy="25" rx="7" ry="7.5" fill="white" fillOpacity="0.92" />

            {/* Face plate — right / inner half of head (facing center) */}
            {/* Half-ellipse path: top-center → rightmost point → bottom-center */}
            <path
                d="M 9 17.5 Q 16 18.5 16 25 Q 16 31.5 9 32.5 Z"
                fill="white"
                fillOpacity="0.68"
            />

            {/* Robot square eye on face plate */}
            <rect x="13" y="22.5" width="2.5" height="2.5" rx="0.5" fill="#6366f1" />
            {/* Mouth vent lines */}
            <rect x="13.2" y="26.5" width="2.2" height="0.65" rx="0.3" fill="#6366f1" fillOpacity="0.4" />
            <rect x="13.2" y="27.5" width="2.2" height="0.65" rx="0.3" fill="#6366f1" fillOpacity="0.4" />

            {/* Ear/side sensor */}
            <circle cx="2.2" cy="25" r="1.1" fill="white" fillOpacity="0.5" />

            {/* ══ Right robot — round skull profile, facing left ══ */}

            {/* Antenna */}
            <rect x="29" y="14" width="1.5" height="4" rx="0.6" fill="white" fillOpacity="0.7" />
            <circle cx="29.75" cy="13.2" r="1.4" fill="white" fillOpacity="0.7" />

            {/* Round skull */}
            <ellipse cx="27" cy="25" rx="7" ry="7.5" fill="white" fillOpacity="0.7" />

            {/* Face plate — left / inner half of head (facing center) */}
            <path
                d="M 27 17.5 Q 20 18.5 20 25 Q 20 31.5 27 32.5 Z"
                fill="white"
                fillOpacity="0.5"
            />

            {/* Robot square eye on face plate */}
            <rect x="20.5" y="22.5" width="2.5" height="2.5" rx="0.5" fill="#7c3aed" fillOpacity="0.9" />
            {/* Mouth vent lines */}
            <rect x="20.6" y="26.5" width="2.2" height="0.65" rx="0.3" fill="#7c3aed" fillOpacity="0.4" />
            <rect x="20.6" y="27.5" width="2.2" height="0.65" rx="0.3" fill="#7c3aed" fillOpacity="0.4" />

            {/* Ear/side sensor */}
            <circle cx="33.8" cy="25" r="1.1" fill="white" fillOpacity="0.4" />

            </g>
        </svg>
    );
}
