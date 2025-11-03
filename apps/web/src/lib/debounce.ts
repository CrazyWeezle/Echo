export function debounce<F extends (...a: any[]) => void>(fn: F, wait: number) {
    let t: any;
    return (...args: Parameters<F>) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}
