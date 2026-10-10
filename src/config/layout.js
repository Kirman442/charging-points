// Keep CSS media queries aligned with this inclusive mobile breakpoint.
export const MOBILE_MAX_WIDTH = 767
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`
export const isMobileWidth = width => width <= MOBILE_MAX_WIDTH
