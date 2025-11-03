import { Component, ReactNode } from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{err?:any}> {
    state = { err: null as any };
    static getDerivedStateFromError(err:any){ return { err }; }
    render(){
        if (this.state.err) {
            return <div style={{padding:24,color:'#fff',background:'#111'}}>
                <h2>Something went wrong.</h2>
                <pre style={{whiteSpace:'pre-wrap'}}>{String(this.state.err?.message||this.state.err)}</pre>
            </div>;
            }
        return this.props.children;
    }
}
