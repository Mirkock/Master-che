class Passthrough extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    for (let c = 0; c < Math.min(i.length, o.length); c++) o[c].set(i[c]);
    return true;
  }
}
registerProcessor('passthrough', Passthrough);
